import type { ConnectionState } from "@/hooks/useTaskEvents";
import { cn } from "@/lib/utils";

const STATES: Record<ConnectionState, { label: string; dot: string; pulse: boolean }> = {
  live: { label: "Live", dot: "bg-emerald-500", pulse: true },
  connecting: { label: "Connecting", dot: "bg-amber-500", pulse: false },
  paused: { label: "Paused", dot: "bg-slate-400", pulse: false },
  offline: { label: "Offline", dot: "bg-red-500", pulse: false },
};

export function LiveIndicator({ state }: { state: ConnectionState }) {
  const { label, dot, pulse } = STATES[state];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
      title={state === "live" ? "New tasks appear automatically" : undefined}
      aria-live="polite"
    >
      <span className="relative flex size-2">
        {pulse && (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-75",
              dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", dot)} />
      </span>
      {label}
    </span>
  );
}
