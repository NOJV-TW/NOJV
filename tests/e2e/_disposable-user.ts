import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { apiWriteHeaders } from "./_shared";

export const TEST_PASSWORD = "password123";

export function psql(sql: string): string {
  resolveDestructiveTestDatabase("nojv_e2e_test");
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "nojv_e2e_test",
      "-tA",
    ],
    { input: sql, encoding: "utf8" },
  ).trim();
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

  create(
    input: {
      isSuperAdmin?: boolean;
      mustChangePassword?: boolean;
      platformRole?: "admin" | "student" | "teacher";
    } = {},
  ): void {
    const platformRole = input.platformRole ?? "student";
    psql(`
      INSERT INTO "User" (id, email, username, name, "emailVerified", "platformRole", "isSuperAdmin", "mustChangePassword", "studentTourSeenAt", "teacherTourSeenAt", "createdAt", "updatedAt")
      VALUES ('${this.id}', '${this.email}', '${this.username}', '${this.name}', true, '${platformRole}', ${String(input.isSuperAdmin ?? false)}, ${String(input.mustChangePassword ?? false)}, NOW(), NOW(), NOW(), NOW());
      INSERT INTO "Account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      SELECT '${this.accountId}', '${this.id}', 'credential', '${this.id}', password, NOW(), NOW()
      FROM "Account"
      WHERE id = 'acct_student';
    `);
  }

  cleanup(): void {
    const sessionIds = psql(`SELECT id FROM "Session" WHERE "userId" = '${this.id}';`)
      .split("\n")
      .filter(Boolean);
    psql(`DELETE FROM "User" WHERE id = '${this.id}';`);
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
    execFileSync("docker", [
      "compose",
      "exec",
      "-T",
      "redis",
      "redis-cli",
      "DEL",
      ...redisKeys,
    ]);
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
  await page.goto("/dashboard", { waitUntil: "networkidle" });
}
