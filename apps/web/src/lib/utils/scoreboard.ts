export function contestNotStarted(startsAt: string | Date, now: Date = new Date()): boolean {
  return new Date(startsAt).getTime() > now.getTime();
}

export function entriesAroundUser<T extends { userId: string }>(
  entries: T[],
  userId: string | null,
  radius: number,
): T[] {
  if (userId == null) return entries;
  const index = entries.findIndex((e) => e.userId === userId);
  if (index < 0) return entries;
  return entries.slice(Math.max(0, index - radius), index + radius + 1);
}
