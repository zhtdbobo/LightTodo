import { invoke } from "@tauri-apps/api/core";
import type { Group, CreateGroupInput, UpdateGroupInput } from "../types";

// 转换 camelCase 到 snake_case
function toSnakeCase(obj: any): any {
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
function toCamelCase(obj: any): any {
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

// 获取所有分组
export async function getAllGroups(): Promise<Group[]> {
  const result = await invoke("get_all_groups");
  return toCamelCase(result);
}

// 创建分组
export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const result = await invoke("create_group", { input: toSnakeCase(input) });
  return toCamelCase(result);
}

// 更新分组
export async function updateGroup(input: UpdateGroupInput): Promise<Group> {
  const result = await invoke("update_group", { input: toSnakeCase(input) });
  return toCamelCase(result);
}

// 删除分组
export async function deleteGroup(id: string): Promise<void> {
  await invoke("delete_group", { id });
}
