const DEFAULT_RESET_MINUTE = 300;

export function minutesToHHMM(minutes: number | null | undefined): string {
  const total = minutes ?? DEFAULT_RESET_MINUTE;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function hhmmToMinutes(value: string): number {
  const parts = value.split(":");
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return DEFAULT_RESET_MINUTE;
  return hh * 60 + mm;
}
