import type { Handle } from "@sveltejs/kit";
import { apiTokenDomain } from "@nojv/application";

type HandleEvent = Parameters<Handle>[0]["event"];

export function setSecurityHeaders(response: Response): void {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

export function deriveRequestId(headers: Headers): string {
  const incoming = headers.get("x-request-id");
  if (incoming && incoming.length > 0 && incoming.length <= 128 && /^[\w.-]+$/.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}

const FORM_CONTENT_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
  "application/x-sveltekit-formdata",
]);

function isFormContentType(request: Request): boolean {
  const type =
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return FORM_CONTENT_TYPES.has(type);
}

function csrfForbidden(requestId: string): Response {
  return new Response("CSRF validation failed", {
    status: 403,
    headers: { "x-request-id": requestId },
  });
}

// SvelteKit's built-in origin CSRF (csrf.checkOrigin) is disabled globally so
// the credential-authenticated /api/registry/token endpoint can accept the
// docker registry client's cross-origin OAuth2 form POST. Re-implement the
// equivalent protection here for everything else.
export function enforceCsrf(event: HandleEvent, cleanPath: string): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(event.request.method)) {
    return null;
  }

  // Authenticated via HTTP Basic / body credentials, never cookies, so CSRF
  // does not apply; the docker registry client posts cross-origin.
  if (cleanPath === "/api/registry/token") {
    return null;
  }

  const origin = event.request.headers.get("origin");

  // Framework-parity origin CSRF for every other route: block any cross-origin
  // form-content-type submission, including one with no Origin header (which the
  // framework's checkOrigin treated as a mismatch). This is the whole guard for
  // page-route form actions and a defense-in-depth layer under the /api gate.
  if (isFormContentType(event.request) && origin !== event.url.origin) {
    return csrfForbidden(event.locals.requestId);
  }

  if (!cleanPath.startsWith("/api/")) {
    return null;
  }

  if (
    event.locals.apiToken &&
    apiTokenDomain.findApiTokenRouteRule(event.request.method, cleanPath)
  ) {
    return null;
  }

  if (origin && origin !== event.url.origin) {
    return csrfForbidden(event.locals.requestId);
  }

  if (!cleanPath.startsWith("/api/auth")) {
    const xrw = event.request.headers.get("x-requested-with");
    if (xrw !== "fetch") {
      return new Response(
        JSON.stringify({ message: "CSRF token required", code: "csrf_required" }),
        {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-request-id": event.locals.requestId,
          },
        },
      );
    }
  }

  return null;
}
