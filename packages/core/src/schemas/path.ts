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
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function findPathConflict(paths: readonly string[]): [string, string] | null {
  let previous: string | undefined;
  for (const current of [...paths].sort()) {
    if (previous !== undefined && (current === previous || current.startsWith(`${previous}/`)))
      return [previous, current];
    previous = current;
  }
  return null;
}
