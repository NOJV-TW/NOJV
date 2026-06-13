import { BlockList, isIPv4, isIPv6 } from "node:net";

import { participationRepo, type TransactionClient } from "@nojv/db";

import { logViolationThrottledInTx } from "../proctoring/violation-logger";

type IpFamily = "ipv4" | "ipv6";

function classifyIp(ip: string): { family: IpFamily; addr: string } | null {
  if (!ip) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return { family: "ipv4", addr: mapped[1] };
  if (isIPv4(ip)) return { family: "ipv4", addr: ip };
  if (isIPv6(ip)) return { family: "ipv6", addr: ip };
  return null;
}

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
  shouldPin: boolean;
}

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
    await participationRepo.withTx(tx).updateExamIpPin(participation.id, clientIp);
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
