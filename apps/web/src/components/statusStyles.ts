import type { PriorityValue, TaskStatusValue } from "@taskbot/shared/types";

export const STATUS_STYLES: Record<
  TaskStatusValue,
  { dot: string; column: string; active: string }
> = {
  PENDING: {
    dot: "bg-amber-500",
    column: "bg-amber-50/60 dark:bg-amber-950/20",
    active: "bg-amber-500 text-white dark:bg-amber-500",
  },
  IN_PROGRESS: {
    dot: "bg-blue-500",
    column: "bg-blue-50/60 dark:bg-blue-950/20",
    active: "bg-blue-600 text-white dark:bg-blue-500",
  },
  COMPLETED: {
    dot: "bg-emerald-500",
    column: "bg-emerald-50/60 dark:bg-emerald-950/20",
    active: "bg-emerald-600 text-white dark:bg-emerald-500",
  },
};

export const PRIORITY_STYLES: Record<PriorityValue, string> = {
  HIGH: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-900",
  MEDIUM:
    "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900",
  LOW: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
};
