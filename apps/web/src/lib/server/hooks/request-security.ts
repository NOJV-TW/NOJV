import type { Handle } from "@sveltejs/kit";

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

export function enforceApiCsrf(event: HandleEvent, cleanPath: string): Response | null {
  if (
    !cleanPath.startsWith("/api/") ||
    ["GET", "HEAD", "OPTIONS"].includes(event.request.method)
  ) {
    return null;
  }

  const origin = event.request.headers.get("origin");
  if (origin && origin !== event.url.origin) {
    return new Response("CSRF validation failed", {
      status: 403,
      headers: { "x-request-id": event.locals.requestId },
    });
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
