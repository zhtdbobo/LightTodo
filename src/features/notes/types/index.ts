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
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
}

// 创建便签输入
export interface CreateNoteInput {
  title: string;
  content: string;
  isTodo: boolean;
  tags: string[];
  color?: string;
  priority?: number;
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
}

// 标签类型
export interface Tag {
  id: string;
  name: string;
  createdAt: number;
}
