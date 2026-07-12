import { describe, expect, it } from "vitest";

import { enforceCsrf } from "$lib/server/hooks/request-security";

const ORIGIN = "https://nojv.tw";

function makeEvent(options: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  apiToken?: unknown;
}) {
  const url = new URL(`${ORIGIN}${options.path ?? "/"}`);
  const method = options.method ?? "POST";
  const isBodyless = ["GET", "HEAD"].includes(method);
  // A string body would auto-set content-type: text/plain (a form content type);
  // default to a JSON body so an unspecified content-type models a normal API
  // fetch, and tests that exercise form submissions set the header explicitly.
  const headers = new Headers(options.headers ?? {});
  if (!isBodyless && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return {
    url,
    request: new Request(url, {
      method,
      headers,
      ...(isBodyless ? {} : { body: "{}" }),
    }),
    locals: { requestId: "req-test", apiToken: options.apiToken ?? null },
  } as unknown as Parameters<typeof enforceCsrf>[0];
}

function run(options: Parameters<typeof makeEvent>[0]): Response | null {
  return enforceCsrf(makeEvent(options), options.path ?? "/");
}

describe("enforceCsrf — page routes (parity with SvelteKit checkOrigin)", () => {
  it("blocks a cross-site form POST without an Origin header", () => {
    const res = run({
      path: "/problems/1",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res?.status).toBe(403);
  });

  it("blocks a cross-site multipart POST from a foreign origin", () => {
    const res = run({
      path: "/settings",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        origin: "https://evil.example.com",
      },
    });
    expect(res?.status).toBe(403);
  });

  it("blocks cross-site form PUT/PATCH/DELETE too", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = run({
        method,
        path: "/settings",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(res?.status, method).toBe(403);
    }
  });

  it("allows a same-origin form POST", () => {
    const res = run({
      path: "/settings",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: ORIGIN,
      },
    });
    expect(res).toBeNull();
  });

  it("allows non-form content types (matches the framework's scope)", () => {
    const res = run({
      path: "/some-page",
      headers: { "content-type": "application/json" },
    });
    expect(res).toBeNull();
  });

  it("ignores GET requests", () => {
    expect(run({ method: "GET", path: "/problems" })).toBeNull();
  });
});

describe("enforceCsrf — /api routes", () => {
  it("blocks a POST without x-requested-with", async () => {
    const res = run({
      path: "/api/submissions",
      headers: { "content-type": "application/json" },
    });
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: "csrf_required" });
  });

  it("allows a POST with x-requested-with: fetch", () => {
    const res = run({
      path: "/api/submissions",
      headers: { "content-type": "application/json", "x-requested-with": "fetch" },
    });
    expect(res).toBeNull();
  });

  it("blocks a cross-origin POST even with x-requested-with", () => {
    const res = run({
      path: "/api/submissions",
      headers: { "x-requested-with": "fetch", origin: "https://evil.example.com" },
    });
    expect(res?.status).toBe(403);
  });

  it("exempts /api/auth from the x-requested-with gate but not from origin checks", () => {
    expect(run({ path: "/api/auth/sign-in" })).toBeNull();
    const crossOrigin = run({
      path: "/api/auth/sign-in",
      headers: { origin: "https://evil.example.com" },
    });
    expect(crossOrigin?.status).toBe(403);
  });

  it("blocks a no-Origin form POST to /api/auth (framework-parity, not exempted)", () => {
    const res = run({
      path: "/api/auth/sign-in",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res?.status).toBe(403);
  });

  it("allows a same-origin form POST to /api/auth", () => {
    const res = run({
      path: "/api/auth/sign-in",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
    });
    expect(res).toBeNull();
  });
});

describe("enforceCsrf — /api/registry/token exemption", () => {
  it("allows the docker/containerd OAuth2 form POST (no Origin, form content type)", () => {
    const res = run({
      path: "/api/registry/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res).toBeNull();
  });

  it("allows it even from a foreign origin — the endpoint is credential-authenticated", () => {
    const res = run({
      path: "/api/registry/token",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.example.com",
      },
    });
    expect(res).toBeNull();
  });
});
