import { m } from "$lib/paraglide/messages.js";

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

function formatPart(date: Date): string {
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());
  return `${month}/${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

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

export interface FmtDateOptions {
  dateOnly?: boolean;
}

/** "M/D HH:MM" or, with `dateOnly`, "M/D". Used by the coursework views. */
export function fmtDate(iso: string | Date, opts: FmtDateOptions = {}): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (opts.dateOnly) return `${String(m)}/${String(day)}`;
  return `${String(m)}/${String(day)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Indexed via `Date#getDay()` (0 = Sunday). Messages live under
// `weekday_short_0..6` in `apps/web/messages/*.json` so the locale
// switches as part of the normal paraglide locale flip.
const WEEKDAY_MESSAGES = [
  m.weekday_short_0,
  m.weekday_short_1,
  m.weekday_short_2,
  m.weekday_short_3,
  m.weekday_short_4,
  m.weekday_short_5,
  m.weekday_short_6,
] as const;

export function fmtWeekday(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return WEEKDAY_MESSAGES[d.getDay()]?.() ?? "";
}

export function diffMs(iso: string | Date, now: Date = new Date()): number {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.getTime() - now.getTime();
}

export interface CountdownParts {
  label: string;
  d: number;
  h: number;
  m: number;
  s: number;
  past: boolean;
}

export function fmtCountdown(ms: number): CountdownParts {
  if (ms <= 0) return { label: m.countdown_past(), d: 0, h: 0, m: 0, s: 0, past: true };
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1_000);
  return { label: m.countdown_remaining(), d: days, h: hours, m: mins, s: secs, past: false };
}

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
