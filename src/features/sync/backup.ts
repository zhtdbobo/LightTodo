import { invoke } from "@tauri-apps/api/core";

export interface BackupSummary {
  noteCount: number;
  groupCount: number;
}

export const exportBackup = (path: string) =>
  invoke<BackupSummary>("export_backup", { path });

export const importBackup = (path: string) =>
  invoke<BackupSummary>("import_backup", { path });
