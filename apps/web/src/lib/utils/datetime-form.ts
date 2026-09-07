type DateTimeFormValue = string | null | undefined;

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateTimeParts(value: string) {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute, seconds = "0", fraction = ""] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(seconds),
    millisecond: Number(fraction.padEnd(3, "0")),
  };

  const timestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second ||
    date.getUTCMilliseconds() !== parts.millisecond
  ) {
    return null;
  }

  return { ...parts, timestamp };
}

/** Convert a datetime-local wall-clock value into an ISO timestamp. */
export function localDateTimeToIso(
  value: DateTimeFormValue,
  timezoneOffsetMinutes?: number,
): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const parts = localDateTimeParts(trimmed);

  // Keep already-normalized ISO values stable when a server response is submitted again.
  if (!parts) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  const offset = timezoneOffsetMinutes ?? new Date(trimmed).getTimezoneOffset();
  return new Date(parts.timestamp + offset * 60_000).toISOString();
}

/** Convert an ISO timestamp into the browser's datetime-local input format. */
export function isoDateTimeToLocal(
  value: DateTimeFormValue,
  timezoneOffsetMinutes?: number,
): string {
  if (!value?.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  if (timezoneOffsetMinutes === undefined) {
    return [
      `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
      `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
    ].join("T");
  }

  const localTimestamp = new Date(date.getTime() - timezoneOffsetMinutes * 60_000);
  return [
    `${String(localTimestamp.getUTCFullYear())}-${pad2(localTimestamp.getUTCMonth() + 1)}-${pad2(localTimestamp.getUTCDate())}`,
    `${pad2(localTimestamp.getUTCHours())}:${pad2(localTimestamp.getUTCMinutes())}`,
  ].join("T");
}

export function serializeDateTimeFields<T extends Record<string, unknown>>(
  data: T,
  fields: readonly (keyof T)[],
  timezoneOffsetMinutes?: number,
  original?: Partial<T>,
): T {
  const result = { ...data };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string") {
      const previous = original?.[field];
      result[field] = localDateTimeToIso(
        typeof previous === "string" &&
          value === isoDateTimeToLocal(previous, timezoneOffsetMinutes)
          ? previous
          : value,
        timezoneOffsetMinutes,
      ) as T[keyof T];
    }
  }
  return result;
}

export function restoreDateTimeFields<T extends Record<string, unknown>>(
  data: T,
  fields: readonly (keyof T)[],
  timezoneOffsetMinutes?: number,
): T {
  const result = { ...data };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string" && value) {
      const local = isoDateTimeToLocal(value, timezoneOffsetMinutes);
      if (local) result[field] = local as T[keyof T];
    }
  }
  return result;
}

export function serializeDateTimeFormData(
  formData: FormData,
  fields: readonly string[],
  timezoneOffsetMinutes?: number,
): void {
  for (const field of fields) {
    const value = formData.get(field);
    if (typeof value !== "string") continue;
    formData.set(field, localDateTimeToIso(value, timezoneOffsetMinutes) ?? "");
  }
}
