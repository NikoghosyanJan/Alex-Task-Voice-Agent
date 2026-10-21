import { MessageSquareText, Mic } from "lucide-react";
import {
  formatTaskNumber,
  PRIORITY_LABELS,
  type PriorityValue,
  type TaskSourceValue,
} from "@taskbot/shared/types";
import { cn } from "@/lib/utils";
import { PRIORITY_STYLES } from "./statusStyles";

/** inline-block keeps a parent's line-through (completed tasks) off the number. */
export function TaskNumber({ number, className }: { number: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block font-mono text-xs font-semibold text-slate-400 tabular-nums dark:text-slate-500",
        className,
      )}
    >
      {formatTaskNumber(number)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: PriorityValue }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        PRIORITY_STYLES[priority],
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function SourceBadge({ source }: { source: TaskSourceValue }) {
  const Icon = source === "VOICE" ? Mic : MessageSquareText;
  return (
    <span
      className="inline-flex items-center gap-1"
      title={source === "VOICE" ? "Created from a voice message" : "Created from a text message"}
    >
      <Icon className="size-3.5" aria-hidden />
      {source === "VOICE" ? "Voice" : "Text"}
    </span>
  );
}
