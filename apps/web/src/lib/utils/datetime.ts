import { TAIPEI_ZONE, taipeiWallDate } from "./taipei-time";
import { m } from "#lib/paraglide/messages.js";
import { getLocale } from "#lib/paraglide/runtime.js";

type DateInput = Date | string | number;

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

function toDate(value: DateInput): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_TIME_DEFAULTS: Intl.DateTimeFormatOptions = {
  timeZone: TAIPEI_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "shortOffset",
};

const DATE_DEFAULTS: Intl.DateTimeFormatOptions = {
  timeZone: TAIPEI_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
};

const TIME_DEFAULTS: Intl.DateTimeFormatOptions = {
  timeZone: TAIPEI_ZONE,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "shortOffset",
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

export function formatSmartTimestamp(
  value: DateInput,
  now: Date = new Date(serverNow()),
): string {
  const d = toDate(value);
  if (!d) return "";
  const locale = getLocale();
  const day = taipeiWallDate(d);
  const today = taipeiWallDate(now);
  const sameDay =
    day.getUTCFullYear() === today.getUTCFullYear() &&
    day.getUTCMonth() === today.getUTCMonth() &&
    day.getUTCDate() === today.getUTCDate();
  if (sameDay) {
    return new Intl.DateTimeFormat(locale, TIME_DEFAULTS).format(d);
  }
  const opts: Intl.DateTimeFormatOptions = {
    month: "numeric",
    day: "numeric",
    ...TIME_DEFAULTS,
  };
  if (day.getUTCFullYear() !== today.getUTCFullYear()) opts.year = "numeric";
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

function formatPart(instant: Date): string {
  const date = taipeiWallDate(instant);
  const month = String(date.getUTCMonth() + 1);
  const day = String(date.getUTCDate());
  return `${month}/${day} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
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
  if (opts.dateOnly) {
    const day = taipeiWallDate(d);
    return `${String(day.getUTCMonth() + 1)}/${String(day.getUTCDate())}`;
  }
  return formatDateTimeCompact(d);
}

let clockSample: { server: number; wall: number; monotonic: number } | undefined;

export function syncServerClock(serverNowMs: number): void {
  clockSample = { server: serverNowMs, wall: Date.now(), monotonic: performance.now() };
}

export function serverNow(): number {
  if (!clockSample) return Date.now();
  return clockSample.server + performance.now() - clockSample.monotonic;
}

export function serverClockNeedsRefresh(): boolean {
  if (!clockSample) return true;
  const elapsedWall = Date.now() - clockSample.wall;
  const elapsedMonotonic = performance.now() - clockSample.monotonic;
  return Math.abs(elapsedWall - elapsedMonotonic) > 1000;
}

export function diffMs(iso: string | Date, now: Date = new Date(serverNow())): number {
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
