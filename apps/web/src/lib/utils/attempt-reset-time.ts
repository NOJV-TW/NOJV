// Daily attempt-reset time is stored as minutes-of-day (0–1439) on the Taipei
// wall clock. UI surfaces it as an HH:MM <input type="time">. Default 300 = 05:00
// mirrors DEFAULT_ATTEMPT_RESET_MINUTE in @nojv/domain.
const DEFAULT_RESET_MINUTE = 300;

/** minutes-of-day → "HH:MM" for <input type="time"> and display. */
export function minutesToHHMM(minutes: number | null | undefined): string {
  const total = minutes ?? DEFAULT_RESET_MINUTE;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "HH:MM" → minutes-of-day; falls back to the default on malformed input. */
export function hhmmToMinutes(value: string): number {
  const parts = value.split(":");
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return DEFAULT_RESET_MINUTE;
  return hh * 60 + mm;
}
