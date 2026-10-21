import { z } from "zod";
import {
  getRedis,
  parseDate,
  PRIORITIES,
  safeJsonParse,
  TASK_SOURCES,
  TASK_STATUSES,
  type TaskChanges,
} from "@taskbot/shared";

export const PENDING_ACTION_TTL_SEC = 24 * 60 * 60;

const taskFieldsSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(PRIORITIES),
  /** ISO 8601 */
  dueDate: z.string().nullable(),
});

const changesSchema = taskFieldsSchema.extend({ status: z.enum(TASK_STATUSES) }).partial();

/** The task as the user saw it when the plan was made, for the summary shown before confirming. */
const snapshotSchema = taskFieldsSchema.extend({
  number: z.number().int(),
  status: z.enum(TASK_STATUSES),
});

const common = {
  id: z.string().min(1),
  /** Only this Telegram user may confirm or cancel. */
  telegramUserId: z.number().int(),
  userId: z.string().min(1),
  chatId: z.number().int(),
  transcript: z.string().nullable(),
};

export const pendingActionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("create"),
    updateId: z.number().int(),
    source: z.enum(TASK_SOURCES),
    originalText: z.string(),
    task: taskFieldsSchema,
  }),
  z.object({
    ...common,
    kind: z.literal("update"),
    taskId: z.string().min(1),
    before: snapshotSchema,
    changes: changesSchema,
  }),
  z.object({
    ...common,
    kind: z.literal("delete"),
    taskId: z.string().min(1),
    before: snapshotSchema,
  }),
]);

export type PendingAction = z.infer<typeof pendingActionSchema>;
export type SerializedTaskChanges = z.infer<typeof changesSchema>;

export function serializeChanges({ dueDate, ...rest }: TaskChanges): SerializedTaskChanges {
  return dueDate === undefined ? rest : { ...rest, dueDate: dueDate?.toISOString() ?? null };
}

export function deserializeChanges({ dueDate, ...rest }: SerializedTaskChanges): TaskChanges {
  return dueDate === undefined ? rest : { ...rest, dueDate: dueDate ? parseDate(dueDate) : null };
}

const key = (id: string) => `tg:action:${id}`;

export async function savePendingAction(action: PendingAction): Promise<void> {
  await getRedis().set(key(action.id), JSON.stringify(action), "EX", PENDING_ACTION_TTL_SEC);
}

/** Null when the action expired, was already handled, or is unreadable. */
export async function getPendingAction(id: string): Promise<PendingAction | null> {
  const raw = await getRedis().get(key(id));
  if (!raw) return null;
  const parsed = pendingActionSchema.safeParse(safeJsonParse(raw));
  return parsed.success ? parsed.data : null;
}

export async function deletePendingAction(id: string): Promise<void> {
  await getRedis().del(key(id));
}
