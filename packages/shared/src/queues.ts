import { Queue, type JobsOptions } from "bullmq";
import { z } from "zod";
import { getRedis } from "./redis";

export const QueueName = {
  Transcription: "transcription",
  TaskProcessing: "task-processing",
  Notifications: "notifications",
} as const;

export type QueueNameValue = (typeof QueueName)[keyof typeof QueueName];

/** Order matters for the serverless drain: earlier pipeline stages are polled first. */
export const ALL_QUEUES: readonly QueueNameValue[] = [
  QueueName.Transcription,
  QueueName.TaskProcessing,
  QueueName.Notifications,
];

const chatId = z.number().int();
const messageId = z.number().int().positive();

export const transcriptionJobSchema = z.object({
  updateId: z.number().int(),
  chatId,
  userId: z.string().min(1),
  messageId,
  statusMessageId: messageId.nullable(),
  fileId: z.string().min(1),
  durationSec: z.number().int().nonnegative(),
  mimeType: z.string().optional(),
  kind: z.enum(["voice", "audio"]),
});

export const taskProcessingJobSchema = z.object({
  updateId: z.number().int(),
  chatId,
  userId: z.string().min(1),
  statusMessageId: messageId.nullable(),
  source: z.enum(["TEXT", "VOICE"]),
  text: z.string().trim().min(1),
  transcript: z.string().optional(),
});

export const notificationJobSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task_created"),
    taskId: z.string().min(1),
    chatId,
    statusMessageId: messageId.nullable(),
  }),
  z.object({
    kind: z.literal("task_status_changed"),
    taskId: z.string().min(1),
  }),
]);

export type TranscriptionJob = z.infer<typeof transcriptionJobSchema>;
export type TaskProcessingJob = z.infer<typeof taskProcessingJobSchema>;
export type NotificationJob = z.infer<typeof notificationJobSchema>;

export interface JobDataMap {
  transcription: TranscriptionJob;
  "task-processing": TaskProcessingJob;
  notifications: NotificationJob;
}

export const jobSchemas: { [N in QueueNameValue]: z.ZodType<JobDataMap[N]> } = {
  transcription: transcriptionJobSchema,
  "task-processing": taskProcessingJobSchema,
  notifications: notificationJobSchema,
};

/** Short backoff so retries also complete inside a single serverless drain run. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

const globalForQueues = globalThis as unknown as { __taskbotQueues?: Map<QueueNameValue, Queue> };

export function getQueue(name: QueueNameValue): Queue {
  const queues = (globalForQueues.__taskbotQueues ??= new Map());
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getRedis(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, queue);
  }
  return queue;
}

export interface EnqueueOptions {
  /** Deterministic id; BullMQ ignores a second add with the same id (idempotency). */
  jobId?: string;
}

export async function enqueue<N extends QueueNameValue>(
  name: N,
  data: JobDataMap[N],
  options: EnqueueOptions = {},
): Promise<string | undefined> {
  const payload = jobSchemas[name].parse(data);
  const job = await getQueue(name).add(name, payload, { jobId: options.jobId });
  return job.id;
}

export type Enqueue = typeof enqueue;
