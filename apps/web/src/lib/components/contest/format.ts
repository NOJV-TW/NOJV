/** Compute a contest's lifecycle bucket from its start/end timestamps. */
export function contestStatusFor(
  startsAt: string | Date,
  endsAt: string | Date,
  now: Date = new Date(),
): "upcoming" | "live" | "ended" {
  const s = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const e = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  if (now < s) return "upcoming";
  if (now <= e) return "live";
  return "ended";
}

/** Total contest duration in whole minutes. */
export function durationMinutes(startsAt: string | Date, endsAt: string | Date): number {
  const s = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const e = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 60_000));
}
