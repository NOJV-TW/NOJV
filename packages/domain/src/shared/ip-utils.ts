import { examParticipationIpRepo, type TransactionClient } from "@nojv/db";

import { logViolationInTx } from "../proctoring/violation-logger";

// Client-IP resolution lives in the web layer (`apps/web/src/lib/server/shared/client-ip.ts`)
// because it depends on SvelteKit's `RequestEvent` and on the Cloudflare trust
// model documented in `docs/SECURITY.md`. The domain only operates on the
// already-resolved IP string passed into `checkIpLock`.

function ipToNumber(ip: string): number | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) ip = mapped[1];

  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = Number(part);
    if (Number.isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0; // unsigned
}

/** Check if an IP falls within a CIDR range. Supports IPv4 and IPv4-mapped IPv6. */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split("/");
  if (!rangeIp) return false;
  const prefix = prefixStr ? Number(prefixStr) : 32;
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(rangeIp);
  if (ipNum === null || rangeNum === null) return false;

  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

/** Check if an IP matches any CIDR range in the whitelist. */
export function isIpInWhitelist(ip: string, whitelist: string[]): boolean {
  return whitelist.some((cidr) => isIpInCidr(ip, cidr));
}

export interface IpLockConfig {
  ipWhitelistEnabled: boolean;
  ipBindingEnabled: boolean;
  ipWhitelist: string[];
  ipViolationMode: string;
}

export interface IpCheckResult {
  allowed: boolean;
  violationType?: "whitelist" | "binding";
}

/**
 * Exam-only IP gate. Contests do not have proctoring — callers must not
 * route contest requests through here.
 */
export async function checkIpLock(
  tx: TransactionClient,
  config: IpLockConfig,
  clientIp: string,
  participation: { id: string; ipPin: string | null } | null,
  context: { userId: string; examId: string }
): Promise<IpCheckResult> {
  // Whitelist check — when enabled, an empty list denies all (fail-closed).
  if (config.ipWhitelistEnabled) {
    if (!isIpInWhitelist(clientIp, config.ipWhitelist)) {
      if (config.ipViolationMode === "block") {
        return { allowed: false, violationType: "whitelist" };
      }
      await logViolationInTx(tx, {
        actualIp: clientIp,
        examId: context.examId,
        expectedIp: config.ipWhitelist.join(", "),
        userId: context.userId,
        violationType: "whitelist"
      });
    }
  }

  if (config.ipBindingEnabled && participation) {
    if (!participation.ipPin) {
      await examParticipationIpRepo.withTx(tx).updateIpPin(participation.id, clientIp);
    } else if (participation.ipPin !== clientIp) {
      if (config.ipViolationMode === "block") {
        return { allowed: false, violationType: "binding" };
      }
      await logViolationInTx(tx, {
        actualIp: clientIp,
        examId: context.examId,
        expectedIp: participation.ipPin,
        userId: context.userId,
        violationType: "binding"
      });
    }
  }

  return { allowed: true };
}
