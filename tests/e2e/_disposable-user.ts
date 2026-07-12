import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

export const TEST_PASSWORD = "password123";

export function psql(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "nojv-postgres-1",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "nojv",
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

  constructor(label: string) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    this.id = `e2e-${label}-${suffix}`;
    this.email = `${this.id}@nojv.local`;
    this.accountId = `${this.id}-account`;
    this.username = `e2e-${label}-${suffix}`;
  }

  create(): void {
    psql(`
      INSERT INTO "User" (id, email, username, name, "emailVerified", "createdAt", "updatedAt")
      VALUES ('${this.id}', '${this.email}', '${this.username}', 'E2E ${this.username}', true, NOW(), NOW());
      INSERT INTO "Account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      SELECT '${this.accountId}', '${this.id}', 'credential', '${this.id}', password, NOW(), NOW()
      FROM "Account"
      WHERE id = 'acct_student';
    `);
  }

  cleanup(): void {
    psql(`DELETE FROM "User" WHERE id = '${this.id}';`);
  }
}

export async function signInWithPassword(page: Page, email: string): Promise<void> {
  await page.goto("/admin-signin", { waitUntil: "networkidle" });
  await page.getByLabel(/username or email/i).fill(email);
  await page.getByLabel(/password/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in|登入/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("signin"), { timeout: 15_000 });
}
