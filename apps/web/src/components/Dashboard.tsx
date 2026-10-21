"use client";

import { RefreshCw, Send, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  formatTaskNumber,
  STATUS_LABELS,
  TASK_STATUSES,
  type TaskDTO,
  type TaskEvent,
  type TaskStatusValue,
} from "@taskbot/shared/types";
import { useTaskEvents } from "@/hooks/useTaskEvents";
import { deleteTask as deleteTaskRequest, fetchTasks, updateTaskStatus } from "@/lib/api";
import { authorName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KanbanBoard } from "./KanbanBoard";
import { ListView } from "./ListView";
import { LiveIndicator } from "./LiveIndicator";
import { STATUS_STYLES } from "./statusStyles";
import { Toolbar, type Filters, type ViewMode } from "./Toolbar";

interface Props {
  initialTasks: TaskDTO[];
  botUsername: string | null;
  loadError: string | null;
}

type TaskMap = ReadonlyMap<string, TaskDTO>;

const HIGHLIGHT_MS = 2_500;

function toMap(tasks: TaskDTO[]): TaskMap {
  return new Map(tasks.map((task) => [task.id, task]));
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Dashboard({ initialTasks, botUsername, loadError }: Props) {
  const [tasks, setTasks] = useState<TaskMap>(() => toMap(initialTasks));
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<ViewMode>("board");
  const [filters, setFilters] = useState<Filters>({ query: "", source: "ALL", priority: "ALL" });
  const [syncing, setSyncing] = useState(false);
  const tasksRef = useRef(tasks);
  /** A late task.updated event must not bring a deleted task back. */
  const deletedIds = useRef(new Set<string>());
  const now = useNow(60_000);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  /** Ignores stale payloads so an older event can't overwrite a newer state. */
  const upsert = useCallback((task: TaskDTO) => {
    if (deletedIds.current.has(task.id)) return;
    setTasks((prev) => {
      const current = prev.get(task.id);
      if (current && current.updatedAt > task.updatedAt) return prev;
      const next = new Map(prev);
      next.set(task.id, task);
      return next;
    });
  }, []);

  const flash = useCallback((id: string) => {
    setHighlighted((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setHighlighted((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, HIGHLIGHT_MS);
  }, []);

  const remove = useCallback((id: string) => {
    deletedIds.current.add(id);
    setTasks((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const onEvent = useCallback(
    (event: TaskEvent) => {
      const isNew = !tasksRef.current.has(event.task.id);
      if (event.type === "task.deleted") {
        remove(event.task.id);
        // Deletions made on this dashboard were already removed and announced.
        if (!isNew) toast(`Task ${formatTaskNumber(event.task.number)} was deleted`);
        return;
      }
      upsert(event.task);
      if (event.type === "task.created" && isNew) {
        flash(event.task.id);
        toast.success("New task from Telegram", {
          description: `${formatTaskNumber(event.task.number)} · ${authorName(event.task.author)}: ${event.task.title}`,
        });
      }
    },
    [upsert, remove, flash],
  );

  const resync = useCallback(async () => {
    setSyncing(true);
    try {
      setTasks(toMap(await fetchTasks()));
    } catch {
      toast.error("Couldn't refresh tasks");
    } finally {
      setSyncing(false);
    }
  }, []);

  const connection = useTaskEvents({ onEvent, onResync: resync });

  const changeStatus = useCallback(
    async (id: string, status: TaskStatusValue) => {
      const previous = tasksRef.current.get(id);
      if (!previous || previous.status === status) return;

      setTasks((prev) => new Map(prev).set(id, { ...previous, status }));
      try {
        upsert(await updateTaskStatus(id, status));
      } catch (err) {
        setTasks((prev) => new Map(prev).set(id, previous));
        toast.error(`Couldn't move "${previous.title}" to ${STATUS_LABELS[status]}`, {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [upsert],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const previous = tasksRef.current.get(id);
      if (!previous) return;

      remove(id);
      try {
        await deleteTaskRequest(id);
        toast.success(`Deleted ${formatTaskNumber(previous.number)} · ${previous.title}`);
      } catch (err) {
        deletedIds.current.delete(id);
        setTasks((prev) => new Map(prev).set(id, previous));
        toast.error(`Couldn't delete "${previous.title}"`, {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [remove],
  );

  const sortedTasks = useMemo(
    () => [...tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const numberQuery = /^#?\d+$/.test(query) ? Number(query.replace("#", "")) : null;
    return sortedTasks.filter(
      (task) =>
        (filters.source === "ALL" || task.source === filters.source) &&
        (filters.priority === "ALL" || task.priority === filters.priority) &&
        (!query ||
          task.number === numberQuery ||
          task.title.toLowerCase().includes(query) ||
          task.description?.toLowerCase().includes(query) ||
          task.originalText.toLowerCase().includes(query)),
    );
  }, [sortedTasks, filters]);

  const counts = useMemo(() => {
    const result: Record<TaskStatusValue, number> = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 };
    for (const task of sortedTasks) result[task.status]++;
    return result;
  }, [sortedTasks]);

  const botLink = botUsername ? `https://t.me/${botUsername}` : null;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <Send className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">TaskBot</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Tasks from Telegram text and voice messages
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveIndicator state={connection} />
          <button
            type="button"
            onClick={resync}
            disabled={syncing}
            className="inline-flex size-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:text-slate-100"
            aria-label="Refresh tasks"
          >
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} aria-hidden />
          </button>
          {botLink && (
            <a
              href={botLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              <Send className="size-3.5" aria-hidden />
              Open bot
            </a>
          )}
        </div>
      </header>

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {loadError}
        </div>
      )}

      <dl className="grid grid-cols-3 gap-3">
        {TASK_STATUSES.map((status) => (
          <div
            key={status}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <dt className="flex items-center gap-2 text-xs font-medium text-slate-500 sm:text-sm dark:text-slate-400">
              <span className={cn("size-2 rounded-full", STATUS_STYLES[status].dot)} aria-hidden />
              {STATUS_LABELS[status]}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{counts[status]}</dd>
          </div>
        ))}
      </dl>

      <Toolbar filters={filters} onFiltersChange={setFilters} view={view} onViewChange={setView} />

      {sortedTasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 px-6 py-16 text-center dark:border-slate-700">
          <Send className="size-8 text-blue-500" aria-hidden />
          <h2 className="text-lg font-semibold">No tasks yet</h2>
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            Send a text or voice message to the bot and it will show up here instantly, e.g.
            &ldquo;Prepare the quarterly report by Friday, high priority&rdquo;.
          </p>
          {botLink && (
            <a
              href={botLink}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Open @{botUsername} in Telegram
            </a>
          )}
        </div>
      ) : view === "board" ? (
        <KanbanBoard
          tasks={visibleTasks}
          now={now}
          highlighted={highlighted}
          onStatusChange={changeStatus}
          onDelete={deleteTask}
        />
      ) : (
        <ListView
          tasks={visibleTasks}
          now={now}
          highlighted={highlighted}
          onStatusChange={changeStatus}
          onDelete={deleteTask}
        />
      )}
    </div>
  );
}
