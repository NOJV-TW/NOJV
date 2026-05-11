import { error } from "@sveltejs/kit";
import type { z } from "zod";

/** Read a trimmed string field from FormData; returns "" for missing or non-string values. */
export function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Read a checkbox field; returns true iff the checkbox is "on". */
export function readCheckbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

/** Read a JSON-encoded form field and validate it with a Zod schema. Throws 400 on failure. */
export function parseJsonField<T>(
  raw: FormDataEntryValue | null,
  schema: z.ZodType<T>,
  fieldName = "data",
): T {
  if (typeof raw !== "string") error(400, `Missing ${fieldName} field`);

  // Wrap JSON.parse so a malformed payload becomes a clean 400 instead of
  // a SyntaxError bubbling out as a 500 from the action handler.
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    error(400, `Invalid ${fieldName}: not valid JSON`);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) error(400, `Invalid ${fieldName}`);
  return parsed.data;
}

/**
 * Non-throwing counterpart of `parseJsonField` for `Actions` — callers
 * use `fail()` to keep the form state instead of redirecting to an error
 * page. Returns a discriminated result so the call site stays terse.
 */
export function tryParseJsonField<T>(
  raw: FormDataEntryValue | null,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false };
  }

  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

/** Read a required string form field (e.g. an ID). Throws 400 if missing. */
export function readStringField(raw: FormDataEntryValue | null, fieldName: string): string {
  if (typeof raw !== "string") error(400, `Missing ${fieldName}`);
  return raw;
}
