import { z } from "zod";

/**
 * Course-member handle (spec §5.3). Teachers paste one handle per line
 * when bulk-adding students to a course; the handle is the string the
 * school's OAuth provider maps onto a student (e.g. `ntu_b11902001`,
 * `ntust_b11902001`, or a plain NTNU student id like `41034049s`).
 *
 * Stored in `User.username` (reused from better-auth's `username`
 * plugin). The validator here is intentionally stricter than the
 * better-auth plugin regex: teacher-paste accepts only lowercase
 * letters, digits, and underscores — no dots or hyphens — so pastes
 * that include email addresses, punctuation, or whitespace cruft get
 * rejected with a clear error. 3–32 characters accommodates every
 * supported school's id format with headroom.
 */
export const userHandleSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_]+$/, "handle must be lowercase letters, digits, or underscores");

export type UserHandle = z.infer<typeof userHandleSchema>;
