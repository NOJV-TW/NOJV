/**
 * Small client-side datetime formatters used by the course overview
 * rows. The prototype pattern is compact zero-padded `M/D HH:mm` for
 * mono-tabular alignment — localised month/day pieces aren't worth
 * the loss of column alignment on the row.
 */

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

function formatPart(date: Date): string {
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());
  return `${month}/${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Render a compact `M/D HH:mm → M/D HH:mm` range string for an
 * assignment or exam row. `start` and `end` may be strings (ISO from
 * the loader) or already-parsed `Date`s.
 */
export function formatTimeRangeCompact(start: string | Date, end: string | Date): string {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;
  return `${formatPart(s)} → ${formatPart(e)}`;
}

/** Single timestamp rendered the same way (for non-range meta). */
export function formatDateTimeCompact(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return formatPart(d);
}

/**
 * Approximate "N days/hours/minutes ago" relative-time string. Keeps
 * the copy short enough to live inside a meta row without wrapping.
 * English fallback; CJK locales get their own paraglide strings when
 * needed — this is a pragmatic helper, not a full i18n library.
 */
export function formatRelativeFromNow(value: string | Date, now: Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const diffMs = now.getTime() - d.getTime();
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let value2: number;
  let unit: "min" | "hr" | "day";
  if (abs < hour) {
    value2 = Math.max(1, Math.round(abs / minute));
    unit = "min";
  } else if (abs < day) {
    value2 = Math.round(abs / hour);
    unit = "hr";
  } else {
    value2 = Math.round(abs / day);
    unit = "day";
  }

  const unitLabel = unit === "min" ? "min" : unit === "hr" ? "hr" : "day";
  const plural = value2 === 1 ? "" : "s";
  const count = String(value2);
  return past ? `${count} ${unitLabel}${plural} ago` : `in ${count} ${unitLabel}${plural}`;
}
