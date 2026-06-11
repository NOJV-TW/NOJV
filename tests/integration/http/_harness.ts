import type { RequestEvent, RequestHandler } from "@sveltejs/kit";

const ORIGIN = "http://localhost:5173";

function isRedirectThrow(e: unknown): e is { status: number; location: string } {
  return typeof e === "object" && e !== null && "status" in e && "location" in e;
}

function isHttpErrorThrow(e: unknown): e is { status: number; body: { message: string } } {
  return typeof e === "object" && e !== null && "status" in e && "body" in e;
}

export interface CallRouteOptions {
  path: string;
  method?: string;
  module: Partial<Record<string, RequestHandler>>;
  params?: Record<string, string>;
  user?: { id: string } | null;
  ip?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function cookieShim(): RequestEvent["cookies"] {
  return {
    get: () => undefined,
    getAll: () => [],
    set: () => undefined,
    delete: () => undefined,
    serialize: () => "",
  } as unknown as RequestEvent["cookies"];
}

export async function callRoute(opts: CallRouteOptions): Promise<Response> {
  const { handle } = await import("../../../apps/web/src/hooks.server");

  const method = (opts.method ?? "GET").toUpperCase();
  const url = new URL(opts.path, ORIGIN);

  const headers = new Headers(opts.headers);
  if (opts.user) headers.set("x-test-user-id", opts.user.id);
  const clientIp = opts.ip ?? "127.0.0.1";
  headers.set("x-dev-ip", clientIp);
  headers.set("cf-connecting-ip", clientIp);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    !url.pathname.startsWith("/api/auth") &&
    !headers.has("x-requested-with")
  ) {
    headers.set("x-requested-with", "fetch");
  }

  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(opts.body);
  }
  const request = new Request(url, init);

  const event = {
    request,
    url,
    params: opts.params ?? {},
    locals: {},
    route: { id: url.pathname },
    cookies: cookieShim(),
    fetch,
    getClientAddress: () => opts.ip ?? "127.0.0.1",
    setHeaders: () => undefined,
    platform: undefined,
    isDataRequest: false,
    isSubRequest: false,
  } as unknown as RequestEvent;

  const resolve = async (ev: RequestEvent): Promise<Response> => {
    const handler = opts.module[ev.request.method];
    if (!handler) return new Response("Method Not Allowed", { status: 405 });
    return (await handler(ev)) as Response;
  };

  try {
    return await handle({ event, resolve });
  } catch (err) {
    if (isRedirectThrow(err)) {
      return new Response(null, { status: err.status, headers: { location: err.location } });
    }
    if (isHttpErrorThrow(err)) {
      return new Response(JSON.stringify(err.body), {
        status: err.status,
        headers: { "content-type": "application/json" },
      });
    }
    throw err;
  }
}
