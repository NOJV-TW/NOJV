import { formatDate } from "$lib/utils/datetime";

export function relativeTime(value: Date | string | number): string {
  const then = typeof value === "number" ? value : new Date(value).getTime();
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${String(sec)}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${String(day)}d ago`;
  return formatDate(value);
}
