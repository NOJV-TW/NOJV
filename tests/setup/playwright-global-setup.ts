import { chromium, type FullConfig, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../packages/db/generated/prisma/client";
import {
  assertLiveTestDatabase,
  formatTestDatabaseProof,
  resolveDestructiveTestDatabase,
} from "./destructive-test-database";
import { PLAYWRIGHT_STORAGE_ENVIRONMENT } from "./playwright-environment";
import { collectReplayStatements } from "./replay-constraints";

const AUTH_DIR = path.resolve(import.meta.dirname, "../fixtures/auth-states");

/**
 * Admin accounts default to their de-elevated identity. The shared E2E state
 * explicitly provisions the same prerequisites a verified factor creates,
 * then exercises the real elevation endpoint.
 */
async function elevateAdminSession(page: Page, baseURL: string, email: string): Promise<void> {
  const [{ markVerifiedSession, securityGenerationProof }, { prismaAdapterClient }] =
    await Promise.all([import("@nojv/application"), import("@nojv/db")]);
  const user = await prismaAdapterClient.user.update({
    where: { email },
    data: { twoFactorActivated: true },
  });
  const session = await prismaAdapterClient.session.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!session) {
    throw new Error("Admin sign-in did not create a session.");
  }
  if (!(await markVerifiedSession(session.id, securityGenerationProof(user), true))) {
    throw new Error("Admin security state changed while provisioning the E2E session.");
  }

  const res = await page.request.post(`${baseURL}/api/admin-mode`, {
    headers: { "x-requested-with": "fetch" },
    data: { active: true },
  });
  if (!res.ok()) {
    throw new Error(`Failed to elevate admin session: HTTP ${String(res.status())}`);
  }
}

const roles = [
  { name: "admin", email: "admin@nojv.local", password: "password123" },
  { name: "teacher", email: "teacher@nojv.local", password: "password123" },
  { name: "student", email: "student@nojv.local", password: "password123" },
  { name: "new-student", email: "new-student@nojv.local", password: "password123" },
] as const;

export default async function globalSetup(config: FullConfig) {
  const databaseUrl = resolveDestructiveTestDatabase("nojv_e2e_test");
  const envPath = path.resolve(process.cwd(), ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  process.env.DATABASE_URL = databaseUrl;

  const preflight = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const proof = await assertLiveTestDatabase(preflight, "nojv_e2e_test");
    console.info(`Playwright database preflight: ${formatTestDatabaseProof(proof)}`);
  } finally {
    await preflight.$disconnect();
  }

  const childEnvironment = {
    ...process.env,
    ...PLAYWRIGHT_STORAGE_ENVIRONMENT,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    SEED_ADMIN_EMAIL: "admin@nojv.local",
    SEED_ADMIN_PASSWORD: "password123",
    SEED_ADMIN_USERNAME: "admin",
  };
  execFileSync(
    "pnpm",
    ["--filter", "@nojv/db", "exec", "prisma", "db", "push", "--force-reset"],
    { env: childEnvironment, stdio: "inherit" },
  );

  const statements = collectReplayStatements();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    await prisma.$transaction(async (tx) => {
      const proof = await assertLiveTestDatabase(tx, "nojv_e2e_test");
      console.info(`Playwright invariant replay: ${formatTestDatabaseProof(proof)}`);
      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }
    });
  } finally {
    await prisma.$disconnect();
  }

  execFileSync(process.execPath, ["--import", "tsx", "packages/db/prisma/seed.ts"], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "inherit",
  });

  const baseURL = config.projects[0]?.use?.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL is required for E2E setup.");
  }
  await mkdir(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const role of roles) {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(`${baseURL}/admin-signin`, { waitUntil: "networkidle" });
      await page.getByLabel(/username or email/i).fill(role.email);
      await page.getByLabel(/password/i).fill(role.password);
      await page.getByRole("button", { name: /sign in|登入/i }).click();

      if (role.name === "admin") {
        await elevateAdminSession(page, baseURL, role.email);
        await page.goto(`${baseURL}/dashboard`);
      }

      await page.waitForURL((url) => !url.pathname.includes("signin"), {
        timeout: 15000,
      });

      const state = await context.storageState();
      await writeFile(path.join(AUTH_DIR, `${role.name}.json`), JSON.stringify(state));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
