import { z } from "zod";

import { parseRelativePath } from "./path";

export const requiredPathSchema = z.string().transform((rawPath, ctx) => {
  const isDirectoryRequirement = rawPath.endsWith("/");
  const candidate = isDirectoryRequirement ? rawPath.slice(0, -1) : rawPath;
  try {
    const path = parseRelativePath(candidate);
    return isDirectoryRequirement ? `${path}/` : path;
  } catch (err) {
    ctx.addIssue({
      code: "custom",
      message: err instanceof Error ? err.message : "Path contains unsafe characters",
    });
    return z.NEVER;
  }
});

export const requiredPathsSchema = z.array(requiredPathSchema).max(50).default([]);
