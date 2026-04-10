import type { Prisma } from "@nojv/db";

// JSON roundtrip strips `undefined` fields (Zod `.optional()` outputs), which
// Prisma's recursive `InputJsonValue` refuses.
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
