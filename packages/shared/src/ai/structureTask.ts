import { AppError } from "../errors";
import { getOpenAI, getTaskModel } from "./openai";
import {
  STRUCTURED_TASK_JSON_SCHEMA,
  normalizeStructuredTask,
  safeJsonParse,
  type StructuredTask,
} from "./taskSchema";

export interface StructureTaskOptions {
  now?: Date;
  timeZone?: string;
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

export function buildSystemPrompt(now: Date, timeZone: string): string {
  return [
    "You turn a user's message (typed or transcribed from voice) into a single to-do task.",
    "Rules:",
    "- title: concise and actionable, in the same language as the message. Remove filler like 'remind me to' or 'I need to'.",
    "- description: only details not already in the title (people, places, notes); null if none.",
    "- priority: HIGH if urgent, important, ASAP or has a same-day deadline; LOW if optional or 'someday'; otherwise MEDIUM.",
    "- dueDate: resolve relative dates ('tomorrow', 'next Friday', 'in 2 hours') against the current time below.",
    "  Output ISO 8601 with the UTC offset, e.g. 2026-01-31T18:00:00+04:00. If only a day is given, use 18:00 local time. null if no deadline.",
    `Current time: ${describeNow(now, timeZone)}.`,
  ].join("\n");
}

export async function structureTask(
  text: string,
  { now = new Date(), timeZone = "UTC" }: StructureTaskOptions = {},
): Promise<StructuredTask> {
  const completion = await getOpenAI().chat.completions.create({
    model: getTaskModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt(now, timeZone) },
      { role: "user", content: text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "task", strict: true, schema: STRUCTURED_TASK_JSON_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content;
  const task = content ? normalizeStructuredTask(safeJsonParse(content)) : null;
  if (!task) {
    throw new AppError("AI_BAD_OUTPUT", `Unusable structured output: ${content ?? "<empty>"}`);
  }
  return task;
}
