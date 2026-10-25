import { locales } from "#lib/paraglide/runtime.js";

export interface SubmissionHistoryFilters {
  user: string;
  ip: string;
  problem: string;
  language: string;
  verdict: string;
  sort: string;
  order: string;
}

const FILTER_PARAMS = {
  user: "userSearch",
  ip: "ipSearch",
  problem: "filterProblemId",
  language: "language",
  verdict: "status",
  sort: "sort",
  order: "order",
} as const;

const ORDERED_FILTER_PARAMS = [
  ["user", FILTER_PARAMS.user],
  ["ip", FILTER_PARAMS.ip],
  ["problem", FILTER_PARAMS.problem],
  ["language", FILTER_PARAMS.language],
  ["verdict", FILTER_PARAMS.verdict],
  ["sort", FILTER_PARAMS.sort],
  ["order", FILTER_PARAMS.order],
] as const;

function setOrDelete(params: URLSearchParams, key: string, value: string): void {
  if (value) params.set(key, value);
  else params.delete(key);
}

function stripLocalePrefix(pathname: string): string {
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

export function parseSubmissionHistoryFilters(
  source: URL | URLSearchParams,
): SubmissionHistoryFilters {
  const params = source instanceof URL ? source.searchParams : source;
  return {
    user: params.get(FILTER_PARAMS.user) ?? "",
    ip: params.get(FILTER_PARAMS.ip) ?? "",
    problem: params.get(FILTER_PARAMS.problem) ?? "",
    language: params.get(FILTER_PARAMS.language) ?? "",
    verdict: params.get(FILTER_PARAMS.verdict) ?? "",
    sort: params.get(FILTER_PARAMS.sort) ?? "",
    order: params.get(FILTER_PARAMS.order) ?? "",
  };
}

export function submissionHistoryUrl(currentUrl: URL, filters: SubmissionHistoryFilters): URL {
  const nextUrl = new URL(currentUrl);
  for (const key of Object.values(FILTER_PARAMS)) nextUrl.searchParams.delete(key);
  for (const [filter, key] of ORDERED_FILTER_PARAMS) {
    setOrDelete(nextUrl.searchParams, key, filters[filter]);
  }
  return nextUrl;
}

export function submissionHistoryReturnTo(
  currentUrl: URL,
  filters: SubmissionHistoryFilters,
): string {
  const nextUrl = submissionHistoryUrl(currentUrl, filters);
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

export function sanitizeSubmissionHistoryReturnTo(
  value: string | null,
  allowedPath: string,
): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  const url = URL.parse(value, "http://nojv.local");
  if (url?.origin !== "http://nojv.local" || stripLocalePrefix(url.pathname) !== allowedPath) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
