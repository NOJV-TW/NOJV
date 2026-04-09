/**
 * Drop keys whose values are `undefined`. Used to build Prisma update inputs
 * from Zod `.partial()` schemas without tripping `exactOptionalPropertyTypes`.
 * The return type marks every key as optional since stripped keys are omitted.
 */
export function stripUndefined<T extends Record<string, unknown>>(
  obj: T
): Partial<{ [K in keyof T]: Exclude<T[K], undefined> }> {
  const out: Partial<Record<keyof T, unknown>> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key as keyof T] = value;
    }
  }
  return out as Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;
}
