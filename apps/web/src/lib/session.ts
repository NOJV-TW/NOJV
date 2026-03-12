import { sessionUserSchema, type SessionUser } from "@nojv/core";

/**
 * Parse a raw auth user object into a typed SessionUser.
 * Handles the better-auth username plugin field mapping (username ↔ handle).
 */
export function parseSessionUser(raw: unknown): SessionUser | null {
  if (!raw || typeof raw !== "object") return null;

  // Try direct parse — better-auth should return "handle" per our schema config.
  const direct = sessionUserSchema.safeParse(raw);
  if (direct.success) return direct.data;

  // Fallback: username plugin may return "username" instead of "handle" in some contexts.
  if ("username" in raw) {
    const fallback = sessionUserSchema.safeParse({
      ...(raw as Record<string, unknown>),
      handle: (raw as Record<string, unknown>).username ?? null
    });
    if (fallback.success) return fallback.data;
  }

  return null;
}
