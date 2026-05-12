import { BlockList, isIPv4, isIPv6 } from "node:net";

import { examParticipationIpRepo, ipViolationLogRepo, type TransactionClient } from "@nojv/db";

import { logViolationInTx } from "../proctoring/violation-logger";

// Client-IP resolution lives in the web layer (`apps/web/src/lib/server/shared/client-ip.ts`)
// because it depends on SvelteKit's `RequestEvent` and on the Cloudflare trust
// model documented in `docs/SECURITY.md`. The domain only operates on the
// already-resolved IP string passed into `checkIpLock`.

type IpFamily = "ipv4" | "ipv6";

function classifyIp(ip: string): { family: IpFamily; addr: string } | null {
  if (!ip) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return { family: "ipv4", addr: mapped[1] };
  if (isIPv4(ip)) return { family: "ipv4", addr: ip };
  if (isIPv6(ip)) return { family: "ipv6", addr: ip };
  return null;
}

/** Check if an IP falls within a CIDR range. Supports IPv4, IPv6, and v4-mapped v6. */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split("/");
  if (!rangeIp) return false;

  const ipNorm = classifyIp(ip);
  const rangeNorm = classifyIp(rangeIp);
  if (!ipNorm || !rangeNorm) return false;
  if (ipNorm.family !== rangeNorm.family) return false;

  const maxPrefix = rangeNorm.family === "ipv4" ? 32 : 128;
  const prefix = prefixStr === undefined ? maxPrefix : Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return false;

  try {
    const list = new BlockList();
    list.addSubnet(rangeNorm.addr, prefix, rangeNorm.family);
    return list.check(ipNorm.addr, ipNorm.family);
  } catch {
    return false;
  }
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
  context: { userId: string; examId: string },
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
        violationType: "whitelist",
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
        violationType: "binding",
      });
    }
  }

  return { allowed: true };
}

export function listExamIpViolations(opts: { examId: string; take?: number }) {
  return ipViolationLogRepo.listByExam({
    examId: opts.examId,
    take: opts.take ?? 200,
  });
}
