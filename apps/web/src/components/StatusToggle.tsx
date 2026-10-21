"use client";

import { STATUS_LABELS, TASK_STATUSES, type TaskStatusValue } from "@taskbot/shared/types";
import { cn } from "@/lib/utils";
import { STATUS_STYLES } from "./statusStyles";

const SHORT_LABELS: Record<TaskStatusValue, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Done",
};

interface Props {
  value: TaskStatusValue;
  onChange: (status: TaskStatusValue) => void;
  className?: string;
}

export function StatusToggle({ value, onChange, className }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Task status"
      className={cn(
        "flex gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs font-medium dark:bg-slate-800",
        className,
      )}
    >
      {TASK_STATUSES.map((status) => {
        const active = status === value;
        return (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={STATUS_LABELS[status]}
            onClick={() => !active && onChange(status)}
            className={cn(
              "flex-auto rounded-md px-1.5 py-1 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500",
              active
                ? STATUS_STYLES[status].active
                : "text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100",
            )}
          >
            {SHORT_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}
