const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const DEFAULT_ATTEMPT_RESET_MINUTE = 300;

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
