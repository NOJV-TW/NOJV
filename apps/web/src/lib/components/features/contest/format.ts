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

export function durationMinutes(startsAt: string | Date, endsAt: string | Date): number {
  const s = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const e = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 60_000));
}

export function problemLetter(ordinal: number): string {
  if (ordinal < 1) return String(ordinal);
  let n = ordinal;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCodePoint(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}
