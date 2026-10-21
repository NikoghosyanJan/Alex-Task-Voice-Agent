"use client";

import { LayoutGrid, List, Search } from "lucide-react";
import {
  PRIORITY_LABELS,
  PRIORITIES,
  type PriorityValue,
  type TaskSourceValue,
} from "@taskbot/shared/types";
import { cn } from "@/lib/utils";

export type ViewMode = "board" | "list";

export interface Filters {
  query: string;
  source: TaskSourceValue | "ALL";
  priority: PriorityValue | "ALL";
}

interface Props {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

const selectClass =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-sm focus:outline-2 focus:outline-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200";

export function Toolbar({ filters, onFiltersChange, view, onViewChange }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1 sm:max-w-xs">
          <span className="sr-only">Search tasks</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
            placeholder="Search tasks..."
            className={cn(selectClass, "w-full pl-8")}
          />
        </label>

        <select
          aria-label="Filter by source"
          value={filters.source}
          onChange={(event) =>
            onFiltersChange({ ...filters, source: event.target.value as Filters["source"] })
          }
          className={selectClass}
        >
          <option value="ALL">All sources</option>
          <option value="TEXT">Text</option>
          <option value="VOICE">Voice</option>
        </select>

        <select
          aria-label="Filter by priority"
          value={filters.priority}
          onChange={(event) =>
            onFiltersChange({ ...filters, priority: event.target.value as Filters["priority"] })
          }
          className={selectClass}
        >
          <option value="ALL">All priorities</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </div>

      <div
        role="radiogroup"
        aria-label="View"
        className="inline-flex self-start rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        {(
          [
            ["board", "Board", LayoutGrid],
            ["list", "List", List],
          ] as const
        ).map(([mode, label, Icon]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={view === mode}
            onClick={() => onViewChange(mode)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              view === mode
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
