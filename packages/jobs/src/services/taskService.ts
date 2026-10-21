import { getPrisma, Prisma } from "@taskbot/db";
import { publishTaskEvent, type TaskDTO, type TaskStatusValue } from "@taskbot/shared";
import type { StructuredTask, TaskChanges } from "@taskbot/shared";

const taskInclude = {
  user: { select: { username: true, firstName: true, chatId: true, telegramId: true } },
} satisfies Prisma.TaskInclude;

type TaskWithUser = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** Task plus the Telegram context needed to message its owner. */
export interface TaskRecord {
  task: TaskDTO;
  chatId: number;
  ownerTelegramId: number;
  cardMessageId: number | null;
}

export function toTaskDTO(task: TaskWithUser): TaskDTO {
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString() ?? null,
    source: task.source,
    originalText: task.originalText,
    transcript: task.transcript,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    author: { username: task.user.username, firstName: task.user.firstName },
  };
}

function toRecord(task: TaskWithUser): TaskRecord {
  return {
    task: toTaskDTO(task),
    chatId: Number(task.user.chatId),
    ownerTelegramId: Number(task.user.telegramId),
    cardMessageId: task.cardMessageId,
  };
}

function isPrismaError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

export async function listTasks({ limit = 500 }: { limit?: number } = {}): Promise<TaskDTO[]> {
  const tasks = await getPrisma().task.findMany({
    include: taskInclude,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return tasks.map(toTaskDTO);
}

export async function getTaskRecord(id: string): Promise<TaskRecord | null> {
  const task = await getPrisma().task.findUnique({ where: { id }, include: taskInclude });
  return task ? toRecord(task) : null;
}

export async function listRecentTasksForTelegramUser(
  telegramId: number,
  limit = 10,
): Promise<TaskDTO[]> {
  const tasks = await getPrisma().task.findMany({
    where: { user: { telegramId: BigInt(telegramId) } },
    include: taskInclude,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return tasks.map(toTaskDTO);
}

export interface TelegramUserInput {
  telegramId: number;
  chatId: number;
  username?: string | null;
  firstName?: string | null;
}

export async function upsertTelegramUser(input: TelegramUserInput): Promise<{ id: string }> {
  const data = {
    chatId: BigInt(input.chatId),
    username: input.username ?? null,
    firstName: input.firstName ?? null,
  };
  return getPrisma().user.upsert({
    where: { telegramId: BigInt(input.telegramId) },
    create: { telegramId: BigInt(input.telegramId), ...data },
    update: data,
    select: { id: true },
  });
}

export interface CreateTelegramTaskInput extends StructuredTask {
  userId: string;
  updateId: number;
  source: "TEXT" | "VOICE";
  originalText: string;
  transcript?: string | null;
}

/** Idempotent per Telegram update: a retried job returns the task created by the first attempt. */
export async function createTaskFromTelegram(
  input: CreateTelegramTaskInput,
): Promise<{ record: TaskRecord; created: boolean }> {
  const prisma = getPrisma();
  const telegramUpdateId = BigInt(input.updateId);

  const existing = await prisma.task.findUnique({
    where: { telegramUpdateId },
    include: taskInclude,
  });
  if (existing) return { record: toRecord(existing), created: false };

  try {
    const task = await prisma.task.create({
      data: {
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate,
        source: input.source,
        originalText: input.originalText,
        transcript: input.transcript ?? null,
        telegramUpdateId,
        userId: input.userId,
      },
      include: taskInclude,
    });
    const record = toRecord(task);
    await publishTaskEvent({ type: "task.created", task: record.task });
    return { record, created: true };
  } catch (err) {
    if (isPrismaError(err, "P2002")) {
      const raced = await prisma.task.findUnique({
        where: { telegramUpdateId },
        include: taskInclude,
      });
      if (raced) return { record: toRecord(raced), created: false };
    }
    throw err;
  }
}

export function updateTaskStatus(id: string, status: TaskStatusValue): Promise<TaskRecord | null> {
  return updateTask(id, { status });
}

export async function updateTask(id: string, changes: TaskChanges): Promise<TaskRecord | null> {
  try {
    const task = await getPrisma().task.update({
      where: { id },
      data: changes,
      include: taskInclude,
    });
    const record = toRecord(task);
    await publishTaskEvent({ type: "task.updated", task: record.task });
    return record;
  } catch (err) {
    if (isPrismaError(err, "P2025")) return null;
    throw err;
  }
}

export async function setCardMessageId(id: string, cardMessageId: number): Promise<void> {
  await getPrisma().task.update({ where: { id }, data: { cardMessageId } });
}
