use reqwest::{
    header::{HeaderValue, CONTENT_LENGTH, ETAG, IF_MATCH, IF_NONE_MATCH},
    redirect::Policy,
    Client, Method, RequestBuilder, Response, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    io::{Error as IoError, ErrorKind},
    time::Duration,
};

pub const MAX_OBJECT_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_DIRECTORY_LIST_BYTES: usize = 8 * 1024 * 1024;

type WebDAVError = Box<dyn Error + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDAVConfig {
    pub url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone)]
pub struct DownloadedFile {
    pub data: Vec<u8>,
    pub etag: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConditionalWriteResult {
    Written { etag: Option<String> },
    PreconditionFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConditionalDeleteResult {
    Deleted,
    PreconditionFailed,
}

#[derive(Debug, Clone)]
pub struct WebDAVClient {
    client: Client,
    config: WebDAVConfig,
    base_url: Url,
}

fn invalid_input(message: impl Into<String>) -> WebDAVError {
    Box::new(IoError::new(ErrorKind::InvalidInput, message.into()))
}

impl WebDAVClient {
    pub fn new(config: WebDAVConfig) -> Result<Self, WebDAVError> {
        if config.url.len() > 2048 || config.username.len() > 512 || config.password.len() > 4096 {
            return Err(invalid_input("WebDAV 配置字段过长"));
        }
        if config.url.contains('\0')
            || config.username.contains('\0')
            || config.password.contains('\0')
        {
            return Err(invalid_input("WebDAV 配置不能包含 NUL 字符"));
        }
        let base_url = Url::parse(config.url.trim())?;
        if base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(invalid_input(
                "WebDAV 地址必须是无内嵌凭据、查询参数或片段的绝对 URL",
            ));
        }
        let is_localhost = matches!(
            base_url.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("[::1]") | Some("::1")
        );
        if base_url.scheme() != "https" && !(base_url.scheme() == "http" && is_localhost) {
            return Err(invalid_input(
                "WebDAV 地址必须使用 HTTPS；仅 localhost 调试允许 HTTP",
            ));
        }

        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .redirect(Policy::none())
            .user_agent(concat!("LightTodo/", env!("CARGO_PKG_VERSION")))
            .build()?;

        Ok(Self {
            client,
            config,
            base_url,
        })
    }

    fn authenticated(&self, request: RequestBuilder) -> RequestBuilder {
        request.basic_auth(&self.config.username, Some(&self.config.password))
    }

    fn url_for_path(&self, path: &str) -> Result<Url, WebDAVError> {
        let mut url = self.base_url.clone();
        if path.trim_matches('/').is_empty() {
            return Ok(url);
        }

        let mut segments = url
            .path_segments_mut()
            .map_err(|_| invalid_input("WebDAV 地址不能作为分层 URL 使用"))?;
        segments.pop_if_empty();
        for segment in path.trim_matches('/').split('/') {
            if segment.is_empty() || segment == "." || segment == ".." || segment.contains('\\') {
                return Err(invalid_input(format!("非法 WebDAV 路径段: {segment}")));
            }
            segments.push(segment);
        }
        drop(segments);
        Ok(url)
    }

    async fn send_with_retry(&self, request: RequestBuilder) -> Result<Response, WebDAVError> {
        const ATTEMPTS: usize = 3;

        for attempt in 0..ATTEMPTS {
            let current = request
                .try_clone()
                .ok_or_else(|| invalid_input("无法重试当前 WebDAV 请求"))?;
            match current.send().await {
                Ok(response)
                    if attempt + 1 < ATTEMPTS
                        && (response.status().is_server_error()
                            || response.status() == StatusCode::TOO_MANY_REQUESTS) =>
                {
                    tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
                }
                Ok(response) => return Ok(response),
                Err(error)
                    if attempt + 1 < ATTEMPTS && (error.is_connect() || error.is_timeout()) =>
                {
                    tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
                }
                Err(error) => return Err(Box::new(error)),
            }
        }

        Err(invalid_input("WebDAV 请求重试次数已用尽"))
    }

    async fn read_limited(
        &self,
        mut response: Response,
        max_bytes: usize,
    ) -> Result<Vec<u8>, WebDAVError> {
        if response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<usize>().ok())
            .is_some_and(|length| length > max_bytes)
        {
            return Err(invalid_input(format!(
                "WebDAV 响应超过大小上限 {} 字节",
                max_bytes
            )));
        }

        let mut data = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if data.len().saturating_add(chunk.len()) > max_bytes {
                return Err(invalid_input(format!(
                    "WebDAV 响应超过大小上限 {} 字节",
                    max_bytes
                )));
            }
            data.extend_from_slice(&chunk);
        }
        Ok(data)
    }

    /// Test the configured WebDAV endpoint without following redirects, so a
    /// Basic-Auth header can never be forwarded to another host.
    pub async fn test_connection(&self) -> Result<bool, WebDAVError> {
        let response = self
            .send_with_retry(
                self.authenticated(
                    self.client
                        .request(Method::from_bytes(b"PROPFIND")?, self.base_url.clone())
                        .header("Depth", "0"),
                ),
            )
            .await?;

        Ok(response.status().is_success())
    }

    pub async fn upload_file_conditionally(
        &self,
        path: &str,
        content: &[u8],
        if_match: Option<&str>,
        create_only: bool,
    ) -> Result<ConditionalWriteResult, WebDAVError> {
        let url = self.url_for_path(path)?;
        let mut request = self.authenticated(self.client.put(url).body(content.to_vec()));
        if let Some(etag) = if_match {
            request = request.header(IF_MATCH, HeaderValue::from_str(etag)?);
        } else if create_only {
            request = request.header(IF_NONE_MATCH, HeaderValue::from_static("*"));
        }

        let response = self.send_with_retry(request).await?;
        if response.status() == StatusCode::PRECONDITION_FAILED
            || response.status() == StatusCode::CONFLICT
        {
            return Ok(ConditionalWriteResult::PreconditionFailed);
        }
        if response.status().is_success() {
            return Ok(ConditionalWriteResult::Written {
                etag: response
                    .headers()
                    .get(ETAG)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_owned),
            });
        }
        Err(invalid_input(format!(
            "Upload failed: {}",
            response.status()
        )))
    }

    pub async fn download_optional_file(&self, path: &str) -> Result<Option<Vec<u8>>, WebDAVError> {
        Ok(self
            .download_optional_file_with_metadata(path, MAX_OBJECT_BYTES)
            .await?
            .map(|file| file.data))
    }

    pub async fn download_optional_file_with_metadata(
        &self,
        path: &str,
        max_bytes: usize,
    ) -> Result<Option<DownloadedFile>, WebDAVError> {
        let url = self.url_for_path(path)?;
        let response = self
            .send_with_retry(self.authenticated(self.client.get(url)))
            .await?;

        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(invalid_input(format!(
                "Download failed: {}",
                response.status()
            )));
        }

        let etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let data = self.read_limited(response, max_bytes).await?;
        Ok(Some(DownloadedFile { data, etag }))
    }

    #[allow(dead_code)]
    pub async fn file_exists(&self, path: &str) -> Result<bool, WebDAVError> {
        let url = self.url_for_path(path)?;
        let response = self
            .send_with_retry(self.authenticated(self.client.head(url)))
            .await?;
        Ok(response.status().is_success())
    }

    pub async fn delete_file_conditionally(
        &self,
        path: &str,
        if_match: Option<&str>,
    ) -> Result<ConditionalDeleteResult, WebDAVError> {
        let url = self.url_for_path(path)?;
        let mut request = self.authenticated(self.client.delete(url));
        if let Some(etag) = if_match {
            request = request.header(IF_MATCH, HeaderValue::from_str(etag)?);
        }
        let response = self.send_with_retry(request).await?;

        if response.status().is_success()
            || response.status() == StatusCode::NO_CONTENT
            || response.status() == StatusCode::NOT_FOUND
        {
            Ok(ConditionalDeleteResult::Deleted)
        } else if response.status() == StatusCode::PRECONDITION_FAILED
            || response.status() == StatusCode::CONFLICT
        {
            Ok(ConditionalDeleteResult::PreconditionFailed)
        } else {
            Err(invalid_input(format!(
                "Delete failed: {}",
                response.status()
            )))
        }
    }

    /// Fetch only metadata for an existing object. Prefer HEAD to avoid
    /// downloading the object body; fall back to a bounded GET for WebDAV
    /// servers that do not implement HEAD or omit the ETag there. The second
    /// return value is the number of body bytes read by the fallback, so a
    /// caller can include that transfer in its sync budget.
    pub async fn file_etag_with_size(
        &self,
        path: &str,
    ) -> Result<(Option<String>, usize), WebDAVError> {
        let url = self.url_for_path(path)?;
        let head = self
            .send_with_retry(self.authenticated(self.client.head(url.clone())))
            .await?;
        if head.status() == StatusCode::NOT_FOUND {
            return Ok((None, 0));
        }
        if head.status().is_success() {
            if let Some(etag) = head
                .headers()
                .get(ETAG)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
            {
                return Ok((Some(etag), 0));
            }
        } else if !matches!(
            head.status(),
            StatusCode::METHOD_NOT_ALLOWED | StatusCode::NOT_IMPLEMENTED
        ) {
            return Err(invalid_input(format!(
                "Metadata request failed: {}",
                head.status()
            )));
        }

        let response = self
            .send_with_retry(self.authenticated(self.client.get(url)))
            .await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok((None, 0));
        }
        if !response.status().is_success() {
            return Err(invalid_input(format!(
                "Metadata request failed: {}",
                response.status()
            )));
        }
        let etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let data = self.read_limited(response, MAX_OBJECT_BYTES).await?;
        Ok((etag, data.len()))
    }

    pub async fn list_directory(&self, path: &str) -> Result<Vec<String>, WebDAVError> {
        let url = self.url_for_path(path)?;
        let response = self
            .send_with_retry(
                self.authenticated(
                    self.client
                        .request(Method::from_bytes(b"PROPFIND")?, url)
                        .header("Depth", "1"),
                ),
            )
            .await?;

        if response.status() == StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        if !response.status().is_success() {
            return Err(invalid_input(format!(
                "List directory failed: {}",
                response.status()
            )));
        }

        let body = self
            .read_limited(response, MAX_DIRECTORY_LIST_BYTES)
            .await?;
        let xml = std::str::from_utf8(&body)?;
        let document = roxmltree::Document::parse(xml)?;
        let mut files = Vec::new();

        for node in document
            .descendants()
            .filter(|node| node.is_element() && node.tag_name().name() == "href")
        {
            let Some(href) = node.text() else {
                continue;
            };
            let decoded = urlencoding::decode(href).unwrap_or_else(|_| href.into());
            if decoded.ends_with('/') {
                continue;
            }
            if let Some(filename) = decoded.rsplit('/').next().filter(|name| !name.is_empty()) {
                files.push(filename.to_string());
            }
        }

        files.sort();
        files.dedup();
        Ok(files)
    }

    pub async fn create_directory(&self, path: &str) -> Result<(), WebDAVError> {
        let url = self.url_for_path(path)?;
        let response = self
            .send_with_retry(
                self.authenticated(self.client.request(Method::from_bytes(b"MKCOL")?, url)),
            )
            .await?;

        if response.status().is_success()
            || response.status() == StatusCode::CREATED
            || response.status() == StatusCode::METHOD_NOT_ALLOWED
        {
            Ok(())
        } else {
            Err(invalid_input(format!(
                "Create directory failed: {}",
                response.status()
            )))
        }
    }
}
