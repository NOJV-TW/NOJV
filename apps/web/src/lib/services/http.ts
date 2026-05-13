// `X-Requested-With: fetch` is required by hooks.server.ts CSRF gate for all
// /api/** mutations except /api/auth. When the body is a string we assume JSON
// (which is true everywhere in this codebase); FormData / URLSearchParams keep
// browser-set Content-Type. Callers can still override either header.
export function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  if (typeof init.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  return fetch(input, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
}
