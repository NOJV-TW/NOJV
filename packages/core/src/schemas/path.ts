import { z } from "zod";

// Rejects: leading slash (absolute), backslash (Windows separator),
// `..` substring (parent traversal), NUL, and other C0/DEL control chars.
// Shared between submission sourceFile + problem workspace file paths to keep
// path-validation rules consistent and to block forged separators (e.g. `\n`
// in a path would let a student smuggle a fake `// === path ===` boundary
// into MOSS multi-file concatenation).
// eslint-disable-next-line no-control-regex -- control chars are exactly what we're rejecting
const UNSAFE_PATH = /^\/|\\|\.\.|\0|[\x01-\x1f\x7f]/;

export const safeRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((p) => !UNSAFE_PATH.test(p), "Path contains unsafe characters");
