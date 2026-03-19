import type { IpViolationMode } from "@nojv/core";
import { prisma } from "@nojv/db";
import { dev } from "$app/environment";

// ─── IP extraction ───────────────────────────────────────────────────

/**
 * Extract the client IP address from a request.
 * Checks x-forwarded-for, x-real-ip, and in dev mode x-dev-ip.
 */
export function getClientIp(request: Request): string {
  if (dev) {
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
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1]!;

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
  ipViolationMode: IpViolationMode | string;
}

export interface IpCheckResult {
  allowed: boolean;
  violationType?: "whitelist" | "binding";
}

/** Run IP lock checks. Returns whether access is allowed. Logs violations in notify mode. */
export async function checkIpLock(
  config: IpLockConfig,
  clientIp: string,
  participation: { boundIp: string | null; id: string } | null,
  context: { userId: string; contestId?: string; assessmentId?: string },
  /** Model name for updating participation boundIp */
  participationModel: "contestParticipation" | "assessmentParticipation"
): Promise<IpCheckResult> {
  // Whitelist check
  if (config.ipWhitelistEnabled && config.ipWhitelist.length > 0) {
    if (!isIpInWhitelist(clientIp, config.ipWhitelist)) {
      if (config.ipViolationMode === "block") {
        return { allowed: false, violationType: "whitelist" };
      }
      // notify mode: log violation, allow access
      await prisma.ipViolationLog.create({
        data: {
          actualIp: clientIp,
          assessmentId: context.assessmentId ?? null,
          contestId: context.contestId ?? null,
          expectedIp: config.ipWhitelist.join(", "),
          userId: context.userId,
          violationType: "whitelist"
        }
      });
    }
  }

  // Binding check
  if (config.ipBindingEnabled && participation) {
    if (!participation.boundIp) {
      // First visit: bind IP
      if (participationModel === "contestParticipation") {
        await prisma.contestParticipation.update({
          where: { id: participation.id },
          data: { boundIp: clientIp, boundAt: new Date() }
        });
      } else {
        await prisma.assessmentParticipation.update({
          where: { id: participation.id },
          data: { boundIp: clientIp, boundAt: new Date() }
        });
      }
    } else if (participation.boundIp !== clientIp) {
      if (config.ipViolationMode === "block") {
        return { allowed: false, violationType: "binding" };
      }
      // notify mode: log violation, allow access
      await prisma.ipViolationLog.create({
        data: {
          actualIp: clientIp,
          assessmentId: context.assessmentId ?? null,
          contestId: context.contestId ?? null,
          expectedIp: participation.boundIp,
          userId: context.userId,
          violationType: "binding"
        }
      });
    }
  }

  return { allowed: true };
}
