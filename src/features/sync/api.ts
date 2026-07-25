import { invoke } from "@tauri-apps/api/core";

export interface WebDAVConfig {
  url: string;
  username: string;
  password: string;
  has_password?: boolean;
  clear_password?: boolean;
  enabled: boolean;
  auto_sync: boolean;
  directory: string;
  last_sync?: number;
}

export async function getWebDAVConfig(): Promise<WebDAVConfig | null> {
  return await invoke<WebDAVConfig | null>("get_webdav_config");
}

export async function saveWebDAVConfig(config: WebDAVConfig): Promise<void> {
  await invoke("save_webdav_config", { config });
}

export async function testWebDAVConnection(
  url: string,
  username: string,
  password: string
): Promise<boolean> {
  return await invoke<boolean>("test_webdav_connection", {
    url,
    username,
    password,
  });
}

export async function syncNotes(): Promise<string> {
  return await invoke<string>("sync_notes");
}

export async function pushNotes(): Promise<string> {
  return await invoke<string>("push_notes");
}

export async function pullNotes(): Promise<string> {
  return await invoke<string>("pull_notes");
}

export async function resetSyncState(): Promise<void> {
  return await invoke<void>("reset_sync_state");
}

export async function cancelSync(): Promise<void> {
  return await invoke<void>("cancel_sync");
}
