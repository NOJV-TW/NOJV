import {
  contestParticipationIpRepo,
  ipViolationLogRepo,
  type TransactionClient
} from "@nojv/db";

// ─── IP extraction ───────────────────────────────────────────────────

/**
 * Extract the client IP address from a Request.
 * Checks x-forwarded-for, x-real-ip, and (dev only) x-dev-ip.
 */
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

// ─── CIDR matching ───────────────────────────────────────────────────

function ipToNumber(ip: string): number | null {
  // Handle IPv4-mapped IPv6 (::ffff:1.2.3.4)
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

// ─── IP Lock check ──────────────────────────────────────────────────

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
 * Run IP lock checks for a contest. Returns whether access is allowed.
 * Logs violations in notify mode.
 *
 * Homework assessments no longer have IP lock (that was an exam-only
 * concern that now lives on Contest). If you need to gate assessment
 * access, use the contest-backed exam path instead.
 *
 * Accepts a transaction client so the caller controls the transaction boundary.
 */
export async function checkIpLock(
  tx: TransactionClient,
  config: IpLockConfig,
  clientIp: string,
  participation: { boundIp: string | null; id: string } | null,
  context: { userId: string; contestId: string }
): Promise<IpCheckResult> {
  // Whitelist check — when enabled, an empty list denies all (fail-closed).
  if (config.ipWhitelistEnabled) {
    if (!isIpInWhitelist(clientIp, config.ipWhitelist)) {
      if (config.ipViolationMode === "block") {
        return { allowed: false, violationType: "whitelist" };
      }
      // notify mode: log violation, allow access
      await ipViolationLogRepo.withTx(tx).create({
        actualIp: clientIp,
        contestId: context.contestId,
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
      await contestParticipationIpRepo.withTx(tx).updateBoundIp(participation.id, clientIp);
    } else if (participation.boundIp !== clientIp) {
      if (config.ipViolationMode === "block") {
        return { allowed: false, violationType: "binding" };
      }
      // notify mode: log violation, allow access
      await ipViolationLogRepo.withTx(tx).create({
        actualIp: clientIp,
        contestId: context.contestId,
        expectedIp: participation.boundIp,
        userId: context.userId,
        violationType: "binding"
      });
    }
  }

  return { allowed: true };
}
