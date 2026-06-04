const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Default daily reset time when none is configured: 05:00 Taipei (300 min). */
export const DEFAULT_ATTEMPT_RESET_MINUTE = 300;

/**
 * Start of the current daily-attempt window as a real UTC instant.
 *
 * `resetMinuteOfDay` (0–1439) is a Taipei wall-clock time of day — minutes since
 * Taipei midnight (e.g. 390 = 06:30). Asia/Taipei is a fixed UTC+8 offset
 * year-round (no DST), so the window is computed by plain arithmetic.
 */
export function attemptWindowStart(resetMinuteOfDay: number, now: Date): Date {
  const taipei = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const minutesNow = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
  let startWall =
    Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate(), 0, 0, 0, 0) +
    resetMinuteOfDay * MINUTE_MS;
  if (minutesNow < resetMinuteOfDay) {
    startWall -= DAY_MS;
  }
  return new Date(startWall - TAIPEI_OFFSET_MS);
}
