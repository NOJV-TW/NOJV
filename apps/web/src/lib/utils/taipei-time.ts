export const TAIPEI_ZONE = "Asia/Taipei";
export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiWallDate(instant: Date): Date {
  return new Date(instant.getTime() + TAIPEI_OFFSET_MS);
}
