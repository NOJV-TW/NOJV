import { z } from "zod";

// eslint-disable-next-line no-control-regex -- control chars are exactly what we're rejecting
const UNSAFE_PATH = /(?:^\/)|\\|\.\.|\0|[\x01-\x1f\x7f]/;

export const safeRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((p) => !UNSAFE_PATH.test(p), "Path contains unsafe characters");
