import { m } from "$lib/paraglide/messages.js";
import { getLocale } from "$lib/paraglide/runtime.js";

type DateInput = Date | string | number;

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

function toDate(value: DateInput): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_TIME_DEFAULTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

const DATE_DEFAULTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
};

const TIME_DEFAULTS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

export function formatDateTime(value: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(getLocale(), { ...DATE_TIME_DEFAULTS, ...opts }).format(d);
}

export function formatDate(value: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(getLocale(), { ...DATE_DEFAULTS, ...opts }).format(d);
}

export function formatTime(value: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(getLocale(), { ...TIME_DEFAULTS, ...opts }).format(d);
}

export function formatSmartTimestamp(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  const locale = getLocale();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat(locale, TIME_DEFAULTS).format(d);
  }
  const opts: Intl.DateTimeFormatOptions = {
    month: "numeric",
    day: "numeric",
    ...TIME_DEFAULTS,
  };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return new Intl.DateTimeFormat(locale, opts).format(d);
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

export function formatDateTimeCompact(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return formatPart(d);
}

export interface FmtDateOptions {
  dateOnly?: boolean;
}

export function fmtDate(iso: string | Date, opts: FmtDateOptions = {}): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (opts.dateOnly) return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
  return formatDateTimeCompact(d);
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
