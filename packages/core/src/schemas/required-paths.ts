import { z } from "zod";

const PATH_RE = /^[A-Za-z0-9._\-/]+$/;

export const requiredPathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(PATH_RE, "Path may only contain letters, digits, '.', '_', '-', '/'.")
  .refine((p) => !p.includes(".."), "Path may not contain '..'")
  .refine((p) => !p.startsWith("/"), "Path must be relative");

export const requiredPathsSchema = z.array(requiredPathSchema).max(50).default([]);
