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

const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;
export function fmtWeekday(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return ZH_WEEKDAYS[d.getDay()] ?? "";
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
  if (ms <= 0) return { label: "已截止", d: 0, h: 0, m: 0, s: 0, past: true };
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return { label: "剩餘", d, h, m, s, past: false };
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
