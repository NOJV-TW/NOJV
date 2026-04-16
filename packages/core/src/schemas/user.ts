import { z } from "zod";

// Stricter than better-auth's username regex: teacher-paste allows only [a-z0-9_] so punctuation cruft is rejected.
export const userHandleSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_]+$/, "handle must be lowercase letters, digits, or underscores");

export type UserHandle = z.infer<typeof userHandleSchema>;
