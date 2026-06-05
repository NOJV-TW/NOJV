import { z } from "zod";
import type { ZodType } from "zod";

type JsonSchema = Record<string, unknown>;

function stripSchemaKeyword(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaKeyword);
  if (typeof value !== "object" || value === null) return value;

  const result: JsonSchema = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema") continue;
    result[key] = stripSchemaKeyword(child);
  }
  return result;
}

export function zodToOpenApiSchema(schema: ZodType): JsonSchema {
  return stripSchemaKeyword(z.toJSONSchema(schema)) as JsonSchema;
}
