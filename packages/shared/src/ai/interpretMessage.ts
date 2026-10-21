import { z } from "zod";
import { AppError } from "../errors";
import {
  formatTaskNumber,
  PRIORITIES,
  TASK_STATUSES,
  type PriorityValue,
  type TaskStatusValue,
} from "../types";
import { getOpenAI, getTaskModel } from "./openai";
import {
  DESCRIPTION_MAX,
  normalizeStructuredTask,
  parseDate,
  safeJsonParse,
  STRUCTURED_TASK_JSON_SCHEMA,
  TITLE_MAX,
  truncate,
  type StructuredTask,
  type TaskChanges,
} from "./taskSchema";

/** What the model knows about one of the user's existing tasks. */
export interface TaskContext {
  number: number;
  title: string;
  description: string | null;
  status: TaskStatusValue;
  priority: PriorityValue;
  dueDate: string | null;
}

export type MessagePlan =
  | { action: "create"; task: StructuredTask }
  | { action: "update"; taskNumber: number; changes: TaskChanges }
  | { action: "clarify"; message: string };

export interface InterpretOptions {
  tasks: TaskContext[];
  /** Text of the message the user replied to, e.g. a task card. */
  replyTo?: string;
  now?: Date;
  timeZone?: string;
}

const REPLY_MAX = 1_000;

const nullable = <T extends object>(schema: T) => ({ anyOf: [schema, { type: "null" }] });

/** Strict structured outputs: every key is required, unused ones are null. */
export const MESSAGE_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reasoning", "action", "task", "taskNumber", "changes", "message"],
  properties: {
    /** Generated first so the model weighs create vs update and ambiguity before committing. */
    reasoning: {
      type: "string",
      description:
        "One or two sentences: does the message explicitly ask to change an existing task, and which tasks match (by number)?",
    },
    action: { type: "string", enum: ["create", "update", "clarify"] },
    task: nullable(STRUCTURED_TASK_JSON_SCHEMA),
    taskNumber: { type: ["integer", "null"] },
    changes: nullable({
      type: "object",
      additionalProperties: false,
      required: ["title", "description", "priority", "dueDate", "clearDueDate", "status"],
      properties: {
        title: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
        priority: nullable({ type: "string", enum: [...PRIORITIES] }),
        dueDate: { type: ["string", "null"] },
        clearDueDate: { type: "boolean" },
        status: nullable({ type: "string", enum: [...TASK_STATUSES] }),
      },
    }),
    message: { type: ["string", "null"] },
  },
} as const;

const rawChangesSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  priority: z.enum(PRIORITIES).nullable(),
  dueDate: z.string().nullable(),
  clearDueDate: z.boolean(),
  status: z.enum(TASK_STATUSES).nullable(),
});

const rawPlanSchema = z.object({
  action: z.enum(["create", "update", "clarify"]),
  task: z.unknown(),
  taskNumber: z.number().int().nullable(),
  changes: rawChangesSchema.nullable(),
  message: z.string().nullable(),
});

function clarify(message: string): MessagePlan {
  return { action: "clarify", message: truncate(message, REPLY_MAX) };
}

/** Keeps only fields that are set and actually differ from the task's current values. */
function normalizeChanges(
  raw: z.infer<typeof rawChangesSchema>,
  current: TaskContext,
): TaskChanges {
  const changes: TaskChanges = {};

  const title = raw.title?.trim().replace(/\s+/g, " ");
  if (title && title !== current.title) changes.title = truncate(title, TITLE_MAX);

  if (raw.description !== null) {
    const description = truncate(raw.description.trim(), DESCRIPTION_MAX) || null;
    if (description !== current.description) changes.description = description;
  }

  if (raw.priority && raw.priority !== current.priority) changes.priority = raw.priority;
  if (raw.status && raw.status !== current.status) changes.status = raw.status;

  const currentDue = current.dueDate ? parseDate(current.dueDate)?.getTime() : undefined;
  if (raw.clearDueDate) {
    if (currentDue !== undefined) changes.dueDate = null;
  } else if (raw.dueDate) {
    const due = parseDate(raw.dueDate);
    if (due && due.getTime() !== currentDue) changes.dueDate = due;
  }

  return changes;
}

/**
 * Validates model output against the user's tasks. Returns null only when the output is
 * unusable; a reference to an unknown task or an empty change becomes a clarifying reply.
 */
export function normalizePlan(raw: unknown, tasks: readonly TaskContext[]): MessagePlan | null {
  const parsed = rawPlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { action, taskNumber, changes } = parsed.data;
  const message = parsed.data.message?.trim();

  if (action === "create") {
    const task = normalizeStructuredTask(parsed.data.task);
    return task ? { action, task } : null;
  }

  if (action === "update") {
    if (taskNumber === null || !changes) {
      return clarify(
        message || "Which task should I change? You can refer to it by its number, e.g. #05.",
      );
    }
    const target = tasks.find((task) => task.number === taskNumber);
    if (!target) {
      return clarify(`I couldn't find task ${formatTaskNumber(taskNumber)} among your tasks.`);
    }
    const normalized = normalizeChanges(changes, target);
    if (Object.keys(normalized).length === 0) {
      return clarify(
        message ||
          `Task ${formatTaskNumber(taskNumber)} already looks like that, so there's nothing to change.`,
      );
    }
    return { action, taskNumber, changes: normalized };
  }

  return message ? clarify(message) : null;
}

export function describeNow(now: Date, timeZone: string): string {
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")
      ?.value.replace("GMT", "") || "+00:00";
  return `${local} (timezone ${timeZone}, UTC offset ${offset})`;
}

function localDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function describeTasks(tasks: readonly TaskContext[], timeZone: string): string {
  if (tasks.length === 0) return "The user has no tasks yet.";
  return tasks
    .map((task) =>
      JSON.stringify({
        number: task.number,
        title: task.title,
        description: task.description ? truncate(task.description, 200) : null,
        status: task.status,
        priority: task.priority,
        due: task.dueDate ? localDateTime(task.dueDate, timeZone) : null,
      }),
    )
    .join("\n");
}

export function buildSystemPrompt({
  now,
  timeZone,
  tasks,
  replyTo,
}: {
  now: Date;
  timeZone: string;
  tasks: readonly TaskContext[];
  replyTo?: string;
}): string {
  const lines = [
    "You are the assistant behind a Telegram to-do bot. The user's message was typed or transcribed from voice.",
    "Decide what the user wants and answer with exactly one action. The user confirms your plan before anything happens.",
    "Start with `reasoning`: note whether the message explicitly asks to change an existing task and list every task that could match.",
    "- create: the message describes something to do. Fill `task`; taskNumber, changes and message are null.",
    "- update: the user wants to change ONE of their existing tasks (status, priority, title, description or due date). Set `taskNumber` and `changes`; task and message are null.",
    "- clarify: it's unclear which task is meant, several tasks match, the request is something you can't do (deleting tasks, changing several tasks at once, questions), or it isn't about tasks. Put a short, friendly reply in `message`, written in the same language as the user's message (not the timezone's language). List candidate tasks when relevant, written like '#03 Call the dentist'.",
    "",
    "Choosing between create and update:",
    "- Default to create. Choose update only when the message explicitly asks to change an existing task: it uses a verb like mark, move, change, set, rename, put, make, reopen, finish or postpone, or refers to a task number or 'this task'.",
    "- A new to-do that merely resembles an existing task's title is still a create.",
    "",
    "Finding the task to update:",
    "- By number: '#5', 'task 5', 'number five', 'the fifth task' all mean number 5.",
    "- Otherwise match the title or description in the task list below. Words like 'this task' or 'it' refer to the message the user replied to, if any.",
    "- If more than one task could reasonably match, use clarify and list the matching tasks with their numbers. Never guess.",
    "- Status words: start / working on / in progress -> IN_PROGRESS; done / finished / complete -> COMPLETED; reopen / not done / back to pending -> PENDING.",
    "- In `changes`, set only the fields the user asked to change; every other field is null and clearDueDate is false. Set clearDueDate true only to remove the deadline.",
    "",
    "Task fields (for create, and for title/description/priority/dueDate changes):",
    "- title: concise and actionable, in the same language as the message. Remove filler like 'remind me to' or 'I need to'.",
    "- description: only details not already in the title, priority or due date (people, places, notes); null if none.",
    "- priority: HIGH if urgent, important, ASAP or has a same-day deadline; LOW if optional or 'someday'; otherwise MEDIUM.",
    "- dueDate: resolve relative dates ('tomorrow', 'next Friday', 'in 2 hours') against the current time below.",
    "  Output ISO 8601 with the UTC offset, e.g. 2026-01-31T18:00:00+04:00. If only a day is given, use 18:00 local time. null if no deadline.",
    "",
    `Current time: ${describeNow(now, timeZone)}.`,
    "",
    "The user's tasks (most recent first, due times are local):",
    describeTasks(tasks, timeZone),
  ];
  if (replyTo) {
    lines.push("", "The user is replying to this earlier message:", truncate(replyTo, REPLY_MAX));
  }
  return lines.join("\n");
}

export async function interpretMessage(
  text: string,
  { tasks, replyTo, now = new Date(), timeZone = "UTC" }: InterpretOptions,
): Promise<MessagePlan> {
  const completion = await getOpenAI().chat.completions.create({
    model: getTaskModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt({ now, timeZone, tasks, replyTo }) },
      { role: "user", content: text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "message_plan", strict: true, schema: MESSAGE_PLAN_JSON_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content;
  const plan = content ? normalizePlan(safeJsonParse(content), tasks) : null;
  if (!plan) {
    throw new AppError("AI_BAD_OUTPUT", `Unusable structured output: ${content ?? "<empty>"}`);
  }
  return plan;
}
