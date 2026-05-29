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
