/**
 * Client-safe types and constants (no Node or server-only imports).
 * Import via "@taskbot/shared/types" from React client components.
 */

export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"] as const;
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type PriorityValue = (typeof PRIORITIES)[number];

export const TASK_SOURCES = ["TEXT", "VOICE"] as const;
export type TaskSourceValue = (typeof TASK_SOURCES)[number];

export const STATUS_LABELS: Record<TaskStatusValue, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
};

export const PRIORITY_LABELS: Record<PriorityValue, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatusValue;
  priority: PriorityValue;
  dueDate: string | null;
  source: TaskSourceValue;
  originalText: string;
  transcript: string | null;
  createdAt: string;
  updatedAt: string;
  author: {
    username: string | null;
    firstName: string | null;
  };
}

export type TaskEvent =
  { type: "task.created"; task: TaskDTO } | { type: "task.updated"; task: TaskDTO };
