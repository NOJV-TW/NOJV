import { error, type RequestEvent } from "@sveltejs/kit";

import { getWebEnv } from "$lib/server/env";

/**
 * Resolve the client IP under the Cloudflare trust model.
 *
 * ### Production
 * The only trusted source is Cloudflare's `CF-Connecting-IP` header, which
 * the CF edge always overwrites on each inbound request (any client-supplied
 * value is discarded before the request leaves CF). This header ONLY reaches
 * the origin when the request traversed CF. The companion defences are:
 *
 *   - Cloud Run Ingress = "Internal and Cloud Load Balancing" (Cloud Run's
 *     default `*.a.run.app` URL is locked out so direct-to-origin is
 *     impossible).
 *   - GCLB Cloud Armor policy restricting source IP to the official
 *     Cloudflare CIDR ranges (<https://www.cloudflare.com/ips-v4> +
 *     <https://www.cloudflare.com/ips-v6>).
 *
 * If `CF-Connecting-IP` is absent in production we **fail closed with 403**:
 * the request either bypassed CF (misconfiguration / attack) or CF failed to
 * set the header (platform anomaly). Either way we refuse to guess.
 *
 * No fallback to `X-Forwarded-For` — leftmost XFF is trivially spoofable and
 * the rightmost-with-depth variant adds config that can silently rot.
 *
 * ### Development
 * `x-dev-ip` header override (for integration tests that exercise IP-based
 * policies), falling back to the socket address.
 */
export function getClientIp(event: RequestEvent): string {
  const env = getWebEnv();

  if (env.NODE_ENV !== "production") {
    const devIp = event.request.headers.get("x-dev-ip")?.trim();
    if (devIp) return devIp;
    return event.getClientAddress();
  }

  const cfIp = event.request.headers.get("cf-connecting-ip");
  if (!cfIp) {
    // Do NOT fall back to getClientAddress() or XFF — the whole trust model
    // here is that CF is the only ingress path. Missing header = request did
    // not arrive via CF = refuse rather than silently accept a weaker source.
    error(403, "Request must arrive via Cloudflare.");
  }
  return cfIp.trim();
}
