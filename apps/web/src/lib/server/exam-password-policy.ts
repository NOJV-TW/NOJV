export function isExamPasswordSecurityRequest(path: string, method: string): boolean {
  if (path === "/api/registry/token" || path === "/api/api-token-access") return true;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  return [
    "/account",
    "/settings",
    "/users",
    "/complete-profile",
    "/verify-school",
    "/api/account",
    "/api/admin-mode",
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
