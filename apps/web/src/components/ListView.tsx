"use client";

import type { TaskDTO, TaskStatusValue } from "@taskbot/shared/types";
import { authorName, formatDateTime, formatRelative, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PriorityBadge, SourceBadge, TaskNumber } from "./Badges";
import { DeleteTaskButton } from "./DeleteTaskButton";
import { StatusToggle } from "./StatusToggle";

interface Props {
  tasks: TaskDTO[];
  now: number;
  highlighted: ReadonlySet<string>;
  onStatusChange: (id: string, status: TaskStatusValue) => void;
  onDelete: (id: string) => void;
}

export function ListView({ tasks, now, highlighted, onStatusChange, onDelete }: Props) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">
        No tasks match the current filters.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full text-sm">
        <thead className="hidden bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-header-group dark:bg-slate-800/50 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3">Task</th>
            <th className="px-4 py-3">Priority</th>
            <th className="px-4 py-3">Due</th>
            <th className="px-4 py-3">Created</th>
            <th className="w-80 px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {tasks.map((task) => {
            const overdue = isOverdue(task.dueDate, task.status === "COMPLETED", now);
            return (
              <tr
                key={task.id}
                className={cn(
                  "flex flex-col gap-2 p-4 md:table-row md:p-0",
                  highlighted.has(task.id) && "animate-highlight",
                )}
              >
                <td className="md:px-4 md:py-3">
                  <div
                    className={cn(
                      "font-medium break-words",
                      task.status === "COMPLETED" && "text-slate-500 line-through",
                    )}
                  >
                    <TaskNumber number={task.number} className="mr-1.5" />
                    {task.title}
                  </div>
                  <div className="mt-0.5 flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <SourceBadge source={task.source} />
                    <span>{authorName(task.author)}</span>
                  </div>
                </td>
                <td className="md:px-4 md:py-3">
                  <PriorityBadge priority={task.priority} />
                </td>
                <td
                  className={cn(
                    "text-xs md:px-4 md:py-3",
                    overdue ? "font-medium text-red-600 dark:text-red-400" : "text-slate-500",
                  )}
                  suppressHydrationWarning
                >
                  {task.dueDate ? (
                    `${overdue ? "Overdue: " : ""}${formatDateTime(task.dueDate)}`
                  ) : (
                    <span className="md:hidden">No due date</span>
                  )}
                </td>
                <td className="text-xs text-slate-500 md:px-4 md:py-3" suppressHydrationWarning>
                  {formatRelative(task.createdAt, now)}
                </td>
                <td className="md:px-4 md:py-3">
                  <div className="flex items-center gap-1.5">
                    <StatusToggle
                      className="flex-1"
                      value={task.status}
                      onChange={(status) => onStatusChange(task.id, status)}
                    />
                    <DeleteTaskButton task={task} onDelete={onDelete} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
