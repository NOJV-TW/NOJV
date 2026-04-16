import {
  contestParticipationIpRepo,
  examParticipationIpRepo,
  type TransactionClient
} from "@nojv/db";

import { logViolationInTx } from "../proctoring/violation-logger";

export function getClientIp(request: Request): string {
  if (process.env.NODE_ENV === "development") {
    const devIp = request.headers.get("x-dev-ip");
    if (devIp) return devIp.trim();
  }

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "127.0.0.1";
}

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

// As of Phase 3 of the CUID URL unification, both exam and contest
// violations land in `IpViolationLog` via the shared proctoring logger.
export type IpLockScope =
  | { kind: "contest"; contestId: string }
  | { kind: "exam"; examId: string };

export async function checkIpLock(
  tx: TransactionClient,
  config: IpLockConfig,
  clientIp: string,
  participation: { boundIp: string | null; id: string } | null,
  context: { userId: string; scope: IpLockScope }
): Promise<IpCheckResult> {
  const scopeEntity =
    context.scope.kind === "exam"
      ? { entityKind: "exam" as const, entityId: context.scope.examId }
      : { entityKind: "contest" as const, entityId: context.scope.contestId };

  // Whitelist check — when enabled, an empty list denies all (fail-closed).
  if (config.ipWhitelistEnabled) {
    if (!isIpInWhitelist(clientIp, config.ipWhitelist)) {
      if (config.ipViolationMode === "block") {
        return { allowed: false, violationType: "whitelist" };
      }
      // notify mode: log violation, allow access.
      await logViolationInTx(tx, {
        ...scopeEntity,
        actualIp: clientIp,
        expectedIp: config.ipWhitelist.join(", "),
        userId: context.userId,
        violationType: "whitelist"
      });
    }
  }

  // Binding check
  if (config.ipBindingEnabled && participation) {
    if (!participation.boundIp) {
      // First visit: bind IP
      if (context.scope.kind === "exam") {
        await examParticipationIpRepo.withTx(tx).updateIpPin(participation.id, clientIp);
      } else {
        await contestParticipationIpRepo.withTx(tx).updateBoundIp(participation.id, clientIp);
      }
    } else if (participation.boundIp !== clientIp) {
      if (config.ipViolationMode === "block") {
        return { allowed: false, violationType: "binding" };
      }
      // notify mode: log violation, allow access.
      await logViolationInTx(tx, {
        ...scopeEntity,
        actualIp: clientIp,
        expectedIp: participation.boundIp,
        userId: context.userId,
        violationType: "binding"
      });
    }
  }

  return { allowed: true };
}
