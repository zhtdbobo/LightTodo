use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::error::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDAVConfig {
    pub url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug)]
pub struct WebDAVClient {
    client: Client,
    config: WebDAVConfig,
}

impl WebDAVClient {
    pub fn new(config: WebDAVConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }

    /// 测试 WebDAV 连接
    pub async fn test_connection(&self) -> Result<bool, Box<dyn Error>> {
        let response = self
            .client
            .request(reqwest::Method::from_bytes(b"PROPFIND")?, &self.config.url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .header("Depth", "0")
            .send()
            .await?;

        Ok(response.status().is_success())
    }

    /// 上传文件到 WebDAV
    pub async fn upload_file(
        &self,
        path: &str,
        content: &[u8],
    ) -> Result<(), Box<dyn Error>> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), path);

        let response = self
            .client
            .put(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .body(content.to_vec())
            .send()
            .await?;

        if response.status().is_success() || response.status() == StatusCode::CREATED {
            Ok(())
        } else {
            Err(format!("Upload failed: {}", response.status()).into())
        }
    }

    /// 从 WebDAV 下载文件
    #[allow(dead_code)]
    pub async fn download_file(&self, path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), path);

        let response = self
            .client
            .get(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await?;

        if response.status().is_success() {
            Ok(response.bytes().await?.to_vec())
        } else {
            Err(format!("Download failed: {}", response.status()).into())
        }
    }

    /// 检查文件是否存在
    #[allow(dead_code)]
    pub async fn file_exists(&self, path: &str) -> Result<bool, Box<dyn Error>> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), path);

        let response = self
            .client
            .head(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await?;

        Ok(response.status().is_success())
    }

    /// 删除文件
    #[allow(dead_code)]
    pub async fn delete_file(&self, path: &str) -> Result<(), Box<dyn Error>> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), path);

        let response = self
            .client
            .delete(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await?;

        if response.status().is_success() || response.status() == StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(format!("Delete failed: {}", response.status()).into())
        }
    }

    /// 列出目录中的文件
    pub async fn list_directory(&self, path: &str) -> Result<Vec<String>, Box<dyn Error>> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), path);

        let response = self
            .client
            .request(reqwest::Method::from_bytes(b"PROPFIND")?, &url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .header("Depth", "1")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(format!("List directory failed: {}", response.status()).into());
        }

        let body = response.text().await?;
        let mut files = Vec::new();

        // 使用正则表达式提取 href 标签内容
        use regex::Regex;
        let re = Regex::new(r"<[dD]:href>([^<]+)</[dD]:href>").unwrap();

        for cap in re.captures_iter(&body) {
            if let Some(href_match) = cap.get(1) {
                let href = href_match.as_str();

                // 解码 URL 编码（如 %20 -> 空格）
                let decoded = urlencoding::decode(href).unwrap_or_else(|_| href.into());

                // 跳过目录本身（以 / 结尾的）
                if !decoded.ends_with('/') {
                    if let Some(filename) = decoded.split('/').last() {
                        if !filename.is_empty() {
                            files.push(filename.to_string());
                        }
                    }
                }
            }
        }

        Ok(files)
    }
    pub async fn create_directory(&self, path: &str) -> Result<(), Box<dyn Error>> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), path);

        let response = self
            .client
            .request(reqwest::Method::from_bytes(b"MKCOL")?, &url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await?;

        if response.status().is_success() || response.status() == StatusCode::CREATED {
            Ok(())
        } else {
            Err(format!("Create directory failed: {}", response.status()).into())
        }
    }
}
