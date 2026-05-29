import { error, type RequestEvent } from "@sveltejs/kit";

import { getWebEnv } from "$lib/server/env";

export function getClientIp(event: RequestEvent): string {
  const env = getWebEnv();

  if (env.NODE_ENV !== "production") {
    const devIp = event.request.headers.get("x-dev-ip")?.trim();
    if (devIp) return devIp;
    return event.getClientAddress();
  }

  const cfIp = event.request.headers.get("cf-connecting-ip");
  if (!cfIp) {
    error(403, "Request must arrive via Cloudflare.");
  }
  return cfIp.trim();
}
