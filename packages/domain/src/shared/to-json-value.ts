import type { Prisma } from "@nojv/db";

/**
 * Convert a structurally-JSON-compatible value to `Prisma.InputJsonValue`.
 *
 * Uses a JSON roundtrip so that `undefined` fields produced by Zod
 * `.optional()` outputs are stripped (Prisma's recursive `InputJsonValue`
 * type refuses `undefined`). The runtime cost is negligible for small
 * submission/plagiarism result shapes.
 */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
