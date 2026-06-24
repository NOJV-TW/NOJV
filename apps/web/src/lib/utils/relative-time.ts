import { getLocale } from "$lib/paraglide/runtime.js";
import { formatDate } from "$lib/utils/datetime";

export function relativeTime(value: Date | string | number): string {
  const then = typeof value === "number" ? value : new Date(value).getTime();
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto", style: "narrow" });
  if (sec < 60) return rtf.format(-sec, "second");
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.floor(hr / 24);
  if (day < 7) return rtf.format(-day, "day");
  return formatDate(value);
}
