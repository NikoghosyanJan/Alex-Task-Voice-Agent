const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relativeFormat.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function isOverdue(dueIso: string | null, completed: boolean, now = Date.now()): boolean {
  return !!dueIso && !completed && new Date(dueIso).getTime() < now;
}

export function authorName(author: { username: string | null; firstName: string | null }): string {
  if (author.username) return `@${author.username}`;
  return author.firstName ?? "Unknown";
}
