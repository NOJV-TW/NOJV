import { z } from "zod";

export const userHandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(
    /^[a-z0-9._-]+$/,
    "handle must contain lowercase letters, digits, dots, hyphens, or underscores",
  );

export const adminModeRequestSchema = z.object({ active: z.boolean() });
