"use client";

import { Trash2 } from "lucide-react";
import { formatTaskNumber, type TaskDTO } from "@taskbot/shared/types";
import { cn } from "@/lib/utils";

interface Props {
  task: Pick<TaskDTO, "id" | "number" | "title">;
  onDelete: (id: string) => void;
  className?: string;
}

export function DeleteTaskButton({ task, onDelete, className }: Props) {
  const label = `Delete task ${formatTaskNumber(task.number)}`;
  return (
    <button
      type="button"
      onClick={() => {
        if (window.confirm(`${label} "${task.title}"? This can't be undone.`)) onDelete(task.id);
      }}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-500 dark:hover:bg-red-950/50 dark:hover:text-red-400",
        className,
      )}
      aria-label={label}
      title={label}
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}
