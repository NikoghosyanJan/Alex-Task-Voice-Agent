import type { TaskDTO, TaskStatusValue } from "@taskbot/shared/types";

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchTasks(): Promise<TaskDTO[]> {
  const { tasks } = await parse<{ tasks: TaskDTO[] }>(
    await fetch("/api/tasks", { cache: "no-store" }),
  );
  return tasks;
}

export async function updateTaskStatus(id: string, status: TaskStatusValue): Promise<TaskDTO> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const { task } = await parse<{ task: TaskDTO }>(response);
  return task;
}

/** Resolves when the task is gone, including when someone else already deleted it. */
export async function deleteTask(id: string): Promise<void> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status === 404) return;
  if (!response.ok) await parse(response);
}
