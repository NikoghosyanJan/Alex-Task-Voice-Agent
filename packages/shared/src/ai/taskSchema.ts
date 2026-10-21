import { z } from "zod";
import { PRIORITIES, type PriorityValue, type TaskStatusValue } from "../types";

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2_000;

/** JSON Schema sent to OpenAI structured outputs (strict mode: all keys required, nullable instead of optional). */
export const STRUCTURED_TASK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "priority", "dueDate"],
  properties: {
    title: {
      type: "string",
      description: "Short imperative task title, max 80 characters, same language as the input.",
    },
    description: {
      type: ["string", "null"],
      description: "Extra details from the message that don't fit in the title, or null.",
    },
    priority: {
      type: "string",
      enum: [...PRIORITIES],
      description: "HIGH for urgent/ASAP/important, LOW for someday/whenever, otherwise MEDIUM.",
    },
    dueDate: {
      type: ["string", "null"],
      description: "ISO 8601 date-time with UTC offset if a deadline is mentioned, otherwise null.",
    },
  },
} as const;

const rawStructuredTaskSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(PRIORITIES),
  dueDate: z.string().nullable(),
});

export interface StructuredTask {
  title: string;
  description: string | null;
  priority: PriorityValue;
  dueDate: Date | null;
}

/** Fields to change on an existing task; absent keys stay as they are, null clears. */
export interface TaskChanges {
  title?: string;
  description?: string | null;
  priority?: PriorityValue;
  dueDate?: Date | null;
  status?: TaskStatusValue;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Validates model output; returns null if it can't be used. */
export function normalizeStructuredTask(raw: unknown): StructuredTask | null {
  const parsed = rawStructuredTaskSchema.safeParse(raw);
  if (!parsed.success) return null;

  const title = parsed.data.title.trim().replace(/\s+/g, " ");
  if (!title) return null;

  const description = parsed.data.description?.trim() || null;
  return {
    title: truncate(title, TITLE_MAX),
    description: description ? truncate(description, DESCRIPTION_MAX) : null,
    priority: parsed.data.priority,
    dueDate: parsed.data.dueDate ? parseDate(parsed.data.dueDate) : null,
  };
}

/** Used when the AI is unavailable: the raw text still becomes a usable task. */
export function fallbackTask(text: string): StructuredTask {
  const clean = text.trim();
  const firstLine = clean.split(/\r?\n/)[0]?.trim() ?? clean;
  const title = truncate(firstLine.replace(/\s+/g, " "), TITLE_MAX);
  const description = clean.length > title.length ? truncate(clean, DESCRIPTION_MAX) : null;
  return { title: title || "Untitled task", description, priority: "MEDIUM", dueDate: null };
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
