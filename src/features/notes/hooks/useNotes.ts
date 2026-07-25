import { invoke } from "@tauri-apps/api/core";
import type { Note, CreateNoteInput, UpdateNoteInput, Tag } from "../types";

const noteUpdateQueues = new Map<string, Promise<unknown>>();

// 转换 camelCase 到 snake_case
export function toSnakeCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase);
  } else if (obj !== null && typeof obj === "object") {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      acc[snakeKey] = toSnakeCase(obj[key]);
      return acc;
    }, {} as any);
  }
  return obj;
}

// 转换 snake_case 到 camelCase
export function toCamelCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase);
  } else if (obj !== null && typeof obj === "object") {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      acc[camelKey] = toCamelCase(obj[key]);
      return acc;
    }, {} as any);
  }
  return obj;
}

// 获取所有便签
export async function getAllNotes(): Promise<Note[]> {
  const result = await invoke("get_all_notes");
  return toCamelCase(result);
}

// 根据 ID 获取便签
export async function getNoteById(id: string): Promise<Note | null> {
  const result = await invoke("get_note_by_id", { id });
  return result ? toCamelCase(result) : null;
}

// 创建便签
export async function createNote(input: CreateNoteInput): Promise<Note> {
  const result = await invoke("create_note", { input: toSnakeCase(input) });
  return toCamelCase(result);
}

// 更新便签
export async function updateNote(input: UpdateNoteInput): Promise<Note> {
  const previous = noteUpdateQueues.get(input.id) ?? Promise.resolve();
  const request = previous
    .catch(() => undefined)
    .then(async () => {
      const result = await invoke("update_note", { input: toSnakeCase(input) });
      return toCamelCase(result) as Note;
    });
  noteUpdateQueues.set(input.id, request);
  try {
    return await request;
  } finally {
    if (noteUpdateQueues.get(input.id) === request) {
      noteUpdateQueues.delete(input.id);
    }
  }
}

// 删除便签
export async function deleteNote(id: string): Promise<void> {
  const previous = noteUpdateQueues.get(id) ?? Promise.resolve();
  const request = previous
    .catch(() => undefined)
    .then(async () => {
      await invoke("delete_note", { id });
    });
  noteUpdateQueues.set(id, request);
  try {
    await request;
  } finally {
    if (noteUpdateQueues.get(id) === request) {
      noteUpdateQueues.delete(id);
    }
  }
}

// 搜索便签
export async function searchNotes(query: string): Promise<Note[]> {
  const result = await invoke("search_notes", { query });
  return toCamelCase(result);
}

// 获取所有标签
export async function getAllTags(): Promise<Tag[]> {
  const result = await invoke("get_all_tags");
  return toCamelCase(result);
}

