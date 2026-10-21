"use client";

import { CalendarClock } from "lucide-react";
import type { TaskDTO, TaskStatusValue } from "@taskbot/shared/types";
import { authorName, formatDateTime, formatRelative, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PriorityBadge, SourceBadge, TaskNumber } from "./Badges";
import { DeleteTaskButton } from "./DeleteTaskButton";
import { StatusToggle } from "./StatusToggle";

interface Props {
  task: TaskDTO;
  now: number;
  highlighted?: boolean;
  overlay?: boolean;
  onStatusChange: (id: string, status: TaskStatusValue) => void;
  onDelete: (id: string) => void;
}

export function TaskCard({ task, now, highlighted, overlay, onStatusChange, onDelete }: Props) {
  const completed = task.status === "COMPLETED";
  const overdue = isOverdue(task.dueDate, completed, now);

  return (
    <article
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow dark:border-slate-800 dark:bg-slate-900",
        "hover:shadow-md",
        highlighted && "animate-highlight",
        overlay && "rotate-1 cursor-grabbing shadow-xl",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className={cn(
            "font-medium leading-snug break-words",
            completed && "text-slate-500 line-through decoration-slate-400 dark:text-slate-500",
          )}
        >
          <TaskNumber number={task.number} className="mr-1.5" />
          {task.title}
        </h3>
        <PriorityBadge priority={task.priority} />
      </div>

      {task.description && (
        <p className="mt-1 line-clamp-3 text-sm break-words text-slate-600 dark:text-slate-400">
          {task.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <SourceBadge source={task.source} />
        <span>{authorName(task.author)}</span>
        <time
          dateTime={task.createdAt}
          title={formatDateTime(task.createdAt)}
          suppressHydrationWarning
        >
          {formatRelative(task.createdAt, now)}
        </time>
        {task.dueDate && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              overdue && "font-medium text-red-600 dark:text-red-400",
            )}
            suppressHydrationWarning
          >
            <CalendarClock className="size-3.5" aria-hidden />
            {overdue ? "Overdue: " : "Due "}
            {formatDateTime(task.dueDate)}
          </span>
        )}
      </div>

      {task.source === "VOICE" && task.transcript && (
        <details className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200">
            Transcript
          </summary>
          <p className="mt-1 rounded-md bg-slate-50 p-2 italic dark:bg-slate-800/60">
            &ldquo;{task.transcript}&rdquo;
          </p>
        </details>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        <StatusToggle
          className="flex-1"
          value={task.status}
          onChange={(status) => onStatusChange(task.id, status)}
        />
        <DeleteTaskButton task={task} onDelete={onDelete} />
      </div>
    </article>
  );
}
