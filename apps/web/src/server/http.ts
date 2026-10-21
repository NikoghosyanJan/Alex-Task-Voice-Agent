import { timingSafeEqual } from "node:crypto";

export function safeEqual(
  provided: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function jsonError(status: number, error: string, details?: unknown): Response {
  return Response.json({ error, ...(details === undefined ? {} : { details }) }, { status });
}
