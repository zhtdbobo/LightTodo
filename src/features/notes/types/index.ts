// 便签类型定义
export interface Note {
  id: string;
  title: string;
  content: string;
  isTodo: boolean;
  isCompleted: boolean;
  color?: string;
  pinned: boolean;
  priority: number;
  tags: string[];
  groupId?: string;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
  completedAt?: number;
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
  groupId?: string;
}

// 更新便签输入
export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
  isTodo?: boolean;
  isCompleted?: boolean;
  color?: string;
  pinned?: boolean;
  priority?: number;
  tags?: string[];
  groupId?: string;
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
