import { TAIPEI_OFFSET_MS, taipeiWallDate } from "./taipei-time";

type DateTimeFormValue = string | null | undefined;

const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

export function localDateTimeToIso(value: DateTimeFormValue): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const wall = LOCAL_DATE_TIME_PATTERN.exec(trimmed);
  if (wall) {
    const [, second = "00", fraction = ""] = wall;
    const fields = `${trimmed.slice(0, 16)}:${second}.${fraction.padEnd(3, "0")}Z`;
    const date = new Date(fields);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== fields) return undefined;
    return new Date(date.getTime() - TAIPEI_OFFSET_MS).toISOString();
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) return undefined;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isoDateTimeToLocal(value: DateTimeFormValue): string {
  const iso = localDateTimeToIso(value);
  if (!iso) return "";
  return taipeiWallDate(new Date(iso)).toISOString().slice(0, 16);
}

export function serializeDateTimeFields<T extends Record<string, unknown>>(
  data: T,
  fields: readonly (keyof T)[],
  original?: Partial<T>,
): T {
  const result = { ...data };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string") {
      const previous = original?.[field];
      result[field] = localDateTimeToIso(
        typeof previous === "string" && value === isoDateTimeToLocal(previous)
          ? previous
          : value,
      ) as T[keyof T];
    }
  }
  return result;
}

export function restoreDateTimeFields<T extends Record<string, unknown>>(
  data: T,
  fields: readonly (keyof T)[],
): T {
  const result = { ...data };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string" && value) {
      const local = isoDateTimeToLocal(value);
      if (local) result[field] = local as T[keyof T];
    }
  }
  return result;
}

export function serializeDateTimeFormData(formData: FormData, fields: readonly string[]): void {
  for (const field of fields) {
    const value = formData.get(field);
    if (typeof value !== "string") continue;
    formData.set(field, localDateTimeToIso(value) ?? "");
  }
}
