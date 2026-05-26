import { BlockList, isIPv4, isIPv6 } from "node:net";

import { examParticipationIpRepo, type TransactionClient } from "@nojv/db";

import { logViolationThrottledInTx } from "../proctoring/violation-logger";

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

export interface IpLockDecision {
  allowed: boolean;
  violationType?: "whitelist" | "binding";
  /** True when binding is on and no pin exists yet — caller should record clientIp. */
  shouldPin: boolean;
}

/**
 * Pure decision for the exam IP gate. No IO: the caller pins / logs based on
 * the returned flags. Whitelist takes precedence over binding. While a
 * teacher-granted grace window is open (`exemptUntil` in the future) the gate
 * never blocks or flags, but still reports `shouldPin` so the student's new
 * machine is bound by the time the window closes.
 */
export function evaluateIpLock(
  config: IpLockConfig,
  clientIp: string,
  ipPin: string | null,
  opts?: { exemptUntil?: Date | null; now?: Date },
): IpLockDecision {
  const now = opts?.now ?? new Date();
  const exempt = opts?.exemptUntil != null && now < opts.exemptUntil;
  const shouldPin = config.ipBindingEnabled && !ipPin;

  if (exempt) {
    return { allowed: true, shouldPin };
  }

  if (config.ipWhitelistEnabled && !isIpInWhitelist(clientIp, config.ipWhitelist)) {
    return {
      allowed: config.ipViolationMode !== "block",
      violationType: "whitelist",
      shouldPin,
    };
  }

  if (config.ipBindingEnabled && ipPin && ipPin !== clientIp) {
    return {
      allowed: config.ipViolationMode !== "block",
      violationType: "binding",
      shouldPin,
    };
  }

  return { allowed: true, shouldPin };
}

/**
 * Exam-only IP gate. Contests do not have proctoring — callers must not
 * route contest requests through here. Pins the IP on first contact, records
 * every violation (both block and notify modes, throttled), and honours a
 * teacher-granted grace window on the participation.
 */
export async function checkIpLock(
  tx: TransactionClient,
  config: IpLockConfig,
  clientIp: string,
  participation: { id: string; ipPin: string | null; ipGateExemptUntil?: Date | null } | null,
  context: { userId: string; examId: string },
  now: Date = new Date(),
): Promise<IpCheckResult> {
  const decision = evaluateIpLock(config, clientIp, participation?.ipPin ?? null, {
    exemptUntil: participation?.ipGateExemptUntil ?? null,
    now,
  });

  if (decision.shouldPin && participation) {
    await examParticipationIpRepo.withTx(tx).updateIpPin(participation.id, clientIp);
  }

  if (decision.violationType) {
    await logViolationThrottledInTx(
      tx,
      {
        actualIp: clientIp,
        examId: context.examId,
        expectedIp:
          decision.violationType === "whitelist"
            ? config.ipWhitelist.join(", ")
            : (participation?.ipPin ?? null),
        userId: context.userId,
        violationType: decision.violationType,
      },
      now,
    );
  }

  if (!decision.allowed && decision.violationType) {
    return { allowed: false, violationType: decision.violationType };
  }
  return { allowed: true };
}
