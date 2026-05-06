import path from "node:path";

export const ORIGIN = "http://localhost:5173";

export const adminAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/admin.json",
);
export const teacherAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/teacher.json",
);
export const studentAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/student.json",
);

/**
 * Headers that satisfy `hooks.server.ts` CSRF gate on `/api/**` mutations:
 * matching `Origin` plus the `X-Requested-With: fetch` shibboleth.
 */
export const apiWriteHeaders = {
  origin: ORIGIN,
  "x-requested-with": "fetch",
} as const;

/** Form action POSTs go through SvelteKit's own Origin check, no XRW needed. */
export const formActionHeaders = {
  origin: ORIGIN,
} as const;
