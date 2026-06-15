import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { error, type RequestEvent } from "@sveltejs/kit";

import { getWebEnv, type WebEnv } from "$lib/server/env";

const EDGE_TRUST_HEADER = "x-nojv-edge-secret";

function isValidIp(value: string): boolean {
  return isIP(value) !== 0;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function resolveClientIp(
  headers: Headers,
  getClientAddress: () => string,
  env: Pick<WebEnv, "NODE_ENV" | "EDGE_TRUST_SECRET">,
): string {
  if (env.NODE_ENV !== "production") {
    const devIp = headers.get("x-dev-ip")?.trim();
    if (devIp && isValidIp(devIp)) return devIp;
    return getClientAddress();
  }

  const trustSecret = env.EDGE_TRUST_SECRET;
  const presentedSecret = headers.get(EDGE_TRUST_HEADER);
  if (
    !trustSecret ||
    !presentedSecret ||
    !constantTimeEqual(presentedSecret.trim(), trustSecret)
  ) {
    error(403, "Request must arrive via the trusted edge.");
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
