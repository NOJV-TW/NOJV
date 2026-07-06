import { isIP } from "node:net";

import { error, type RequestEvent } from "@sveltejs/kit";

import { getWebEnv, type WebEnv } from "$lib/server/env";

function isValidIp(value: string): boolean {
  return isIP(value) !== 0;
}

export function resolveClientIp(
  headers: Headers,
  getClientAddress: () => string,
  env: Pick<WebEnv, "NODE_ENV">,
): string {
  if (env.NODE_ENV !== "production") {
    const devIp = headers.get("x-dev-ip")?.trim();
    if (devIp && isValidIp(devIp)) return devIp;
    return getClientAddress();
  }

  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (!cfIp || !isValidIp(cfIp)) {
    error(403, "Trusted edge did not provide a valid client IP.");
  }

  return cfIp;
}

export function getClientIp(event: RequestEvent): string {
  const env = getWebEnv();
  return resolveClientIp(event.request.headers, event.getClientAddress, env);
}
