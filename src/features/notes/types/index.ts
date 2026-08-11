// 便签类型定义
export type RepeatRule = "daily" | "weekly" | "monthly";

export interface Note {
  id: string;
  title: string;
  content: string;
  isTodo: boolean;
  isCompleted: boolean;
  color?: string;
  pinned: boolean;
  deadline?: number | null;
  priority: number;
  tags: string[];
  groupId?: string;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
  completedAt?: number;
  repeatRule?: RepeatRule | null;
  decryptionError?: string | null;
}

// 创建便签输入
export interface CreateNoteInput {
  title: string;
  content: string;
  isTodo: boolean;
  tags: string[];
  color?: string;
  priority?: number;
  pinned?: boolean;
  deadline?: number | null;
  groupId?: string;
  repeatRule?: RepeatRule | null;
}

// 更新便签输入
export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
  isTodo?: boolean;
  isCompleted?: boolean;
  color?: string;
  clearColor?: boolean;
  pinned?: boolean;
  deadline?: number | null;
  clearDeadline?: boolean;
  repeatRule?: RepeatRule | null;
  clearRepeatRule?: boolean;
  priority?: number;
  tags?: string[];
  groupId?: string;
  clearGroup?: boolean;
}

// 标签类型
export interface Tag {
  id: string;
  name: string;
  createdAt: number;
}

// 分组类型
export interface Group {
  id: string;
  name: string;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

// 创建分组输入
export interface CreateGroupInput {
  name: string;
}

// 更新分组输入
export interface UpdateGroupInput {
  id: string;
  name?: string;
  displayOrder?: number;
}
