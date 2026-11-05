import { error } from "@sveltejs/kit";
import type { z } from "zod";

export function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function readCheckbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

export function parseJsonField<T>(
  raw: FormDataEntryValue | null,
  schema: z.ZodType<T>,
  fieldName = "data",
): T {
  if (typeof raw !== "string") error(400, `Missing ${fieldName} field`);

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

export function readStringField(raw: FormDataEntryValue | null, fieldName: string): string {
  if (typeof raw !== "string") error(400, `Missing ${fieldName}`);
  return raw;
}

export {
  isoDateTimeToLocal as toDateTimeLocal,
  localDateTimeToIso as toIsoOrUndefined,
} from "#lib/utils/datetime-form.js";
