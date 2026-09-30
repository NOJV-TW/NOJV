import { z } from "zod";

const MAX_RELATIVE_PATH_LENGTH = 300;
const MAX_PATH_SEGMENT_BYTES = 255;
const utf8 = new TextEncoder();

export type SafeRelativePath = string & { readonly __safeRelativePath: unique symbol };

export function parseRelativePath(rawPath: string): SafeRelativePath {
  const path = rawPath.trim().normalize("NFC");
  if (path.length === 0) {
    throw new Error("Path must not be empty");
  }
  if (path.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new Error("Path is too long");
  }
  if (path.startsWith("/")) {
    throw new Error("Path must be relative");
  }
  if (path.includes("\\") || path.includes(":") || hasControlOrNul(path)) {
    throw new Error("Path contains unsafe characters");
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("Path contains unsafe segments");
  }
  if (segments.some((segment) => utf8.encode(segment).length > MAX_PATH_SEGMENT_BYTES)) {
    throw new Error("Path segment is too long");
  }

  return path as SafeRelativePath;
}

function tryParseRelativePath(rawPath: string): SafeRelativePath | null {
  try {
    return parseRelativePath(rawPath);
  } catch {
    return null;
  }
}

export const safeRelativePath = z
  .string()
  .min(1)
  .max(MAX_RELATIVE_PATH_LENGTH)
  .refine((rawPath) => tryParseRelativePath(rawPath) === rawPath, {
    message: "Path contains unsafe characters",
  });

function hasControlOrNul(path: string): boolean {
  for (let i = 0; i < path.length; i += 1) {
    const code = path.codePointAt(i) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function findPathConflict(paths: readonly string[]): [string, string] | null {
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) return [path, path];
    seen.add(path);
  }
  for (const path of paths) {
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      const parent = path.slice(0, slash);
      if (seen.has(parent)) return [parent, path];
    }
  }
  return null;
}
