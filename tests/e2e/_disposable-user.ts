import { randomUUID } from "node:crypto";

import { getRedis } from "@nojv/redis";
import { expect, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../packages/db/generated/prisma/client";
import {
  assertLiveTestDatabase,
  resolveDestructiveTestDatabase,
} from "../setup/destructive-test-database";
import { splitStatements } from "../setup/replay-constraints";
import { apiWriteHeaders } from "./_shared";

export const TEST_PASSWORD = "password123";

export async function psql(sql: string): Promise<string> {
  const databaseUrl = resolveDestructiveTestDatabase("nojv_e2e_test");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    return await prisma.$transaction(async (tx) => {
      await assertLiveTestDatabase(tx, "nojv_e2e_test");
      const output: string[] = [];
      for (const statement of splitStatements(sql)) {
        // ponytail: simple SELECT scalars only; use typed queries for richer results.
        if (/^SELECT\b/i.test(statement)) {
          const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(statement);
          output.push(
            ...rows.map((row) =>
              Object.values(row)
                .map((value) => String(value ?? ""))
                .join("\t"),
            ),
          );
        } else {
          await tx.$executeRawUnsafe(statement);
        }
      }
      return output.join("\n");
    });
  } finally {
    await prisma.$disconnect();
  }
}

export function getTestRedis(): ReturnType<typeof getRedis> {
  const rawUrl = process.env.REDIS_URL;
  if (!rawUrl || rawUrl.trim() !== rawUrl) {
    throw new Error(
      "REDIS_URL is required without surrounding whitespace for E2E Redis access.",
    );
  }
  const url = new URL(rawUrl);
  if (
    url.protocol !== "redis:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") ||
    !["", "/", "/0"].includes(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "E2E REDIS_URL must use redis:// with literal loopback, database 0, and no query or fragment.",
    );
  }
  const redis = getRedis();
  if (
    redis.options.host !== url.hostname ||
    redis.options.port !== Number(url.port || "6379") ||
    redis.options.db !== 0 ||
    redis.options.path
  ) {
    throw new Error("E2E Redis client must match the validated REDIS_URL.");
  }
  return redis;
}

export class DisposableCredentialUser {
  readonly id: string;
  readonly email: string;
  readonly accountId: string;
  readonly username: string;
  readonly name: string;

  constructor(label: string) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    this.id = `e2e-${label}-${suffix}`;
    this.email = `${this.id}@nojv.local`;
    this.accountId = `${this.id}-account`;
    this.username = `e2e-${label}-${suffix}`;
    this.name = `E2E ${this.username}`;
  }

  async create(
    input: {
      isSuperAdmin?: boolean;
      mustChangePassword?: boolean;
      platformRole?: "admin" | "student" | "teacher";
    } = {},
  ): Promise<void> {
    const platformRole = input.platformRole ?? "student";
    await psql(`
      INSERT INTO "User" (id, email, username, name, "emailVerified", "platformRole", "isSuperAdmin", "mustChangePassword", "studentTourSeenAt", "teacherTourSeenAt", "createdAt", "updatedAt")
      VALUES ('${this.id}', '${this.email}', '${this.username}', '${this.name}', true, '${platformRole}', ${String(input.isSuperAdmin ?? false)}, ${String(input.mustChangePassword ?? false)}, NOW(), NOW(), NOW(), NOW());
      INSERT INTO "Account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      SELECT '${this.accountId}', '${this.id}', 'credential', '${this.id}', password, NOW(), NOW()
      FROM "Account"
      WHERE id = 'acct_student';
    `);
  }

  async cleanup(): Promise<void> {
    const redis = getTestRedis();
    const sessionIds = (await psql(`SELECT id FROM "Session" WHERE "userId" = '${this.id}';`))
      .split("\n")
      .filter(Boolean);
    await psql(`DELETE FROM "User" WHERE id = '${this.id}';`);
    const redisKeys = sessionIds.flatMap((sessionId) => [
      `nojv:apitoken:stepup:${sessionId}`,
      `nojv:apitoken:page-mfa:${sessionId}`,
      `nojv:admin:mfa:${sessionId}`,
      `nojv:admin:mode:${sessionId}`,
      `nojv:security:settings-grant:${sessionId}`,
      `nojv:security:pending-totp:${sessionId}`,
    ]);
    redisKeys.push(
      `nojv:security:setup-otp:${this.id}`,
      `nojv:security:setup-otp-attempts:${this.id}`,
      `nojv:super-admin:recovery-otp:${this.id}`,
      `nojv:super-admin:recovery-otp-attempts:${this.id}`,
    );
    await redis.del(...redisKeys);
  }
}

export async function signInWithPassword(
  page: Page,
  email: string,
  password = TEST_PASSWORD,
): Promise<void> {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password },
    headers: apiWriteHeaders,
  });
  if (!response.ok()) {
    throw new Error(`Password sign-in failed with HTTP ${String(response.status())}.`);
  }
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: /open account menu/i })).toBeVisible();
}
