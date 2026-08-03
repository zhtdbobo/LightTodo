use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::{plugin::PluginHandle, Wry};

const PLUGIN_IDENTIFIER: &str = "com.lighttodo.app";
static PLUGIN_HANDLE: OnceLock<PluginHandle<Wry>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetRequest<'a> {
    target: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteRequest<'a> {
    target: &'a str,
    secret: String,
}

#[derive(Deserialize)]
struct ReadResponse {
    value: Option<String>,
}

fn handle() -> Result<&'static PluginHandle<Wry>, String> {
    PLUGIN_HANDLE
        .get()
        .ok_or_else(|| "Android secure storage is not initialized".to_string())
}

pub fn read(target: &str) -> Result<Option<Vec<u8>>, String> {
    let response: ReadResponse = handle()?
        .run_mobile_plugin("read", TargetRequest { target })
        .map_err(|error| error.to_string())?;
    response
        .value
        .map(|value| STANDARD.decode(value).map_err(|error| error.to_string()))
        .transpose()
}

pub fn write(target: &str, secret: &[u8]) -> Result<(), String> {
    handle()?
        .run_mobile_plugin::<()>(
            "write",
            WriteRequest {
                target,
                secret: STANDARD.encode(secret),
            },
        )
        .map_err(|error| error.to_string())
}

pub fn delete(target: &str) -> Result<(), String> {
    handle()?
        .run_mobile_plugin::<()>("delete", TargetRequest { target })
        .map_err(|error| error.to_string())
}

pub fn init() -> tauri::plugin::TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("secure-storage")
        .setup(|_app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SecureStoragePlugin")?;
            PLUGIN_HANDLE
                .set(handle)
                .map_err(|_| "Android secure storage was initialized twice")?;
            Ok(())
        })
        .build()
}
