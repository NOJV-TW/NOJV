import { chromium, type FullConfig, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prismaAdapterClient } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";

const AUTH_DIR = path.resolve(import.meta.dirname, "../fixtures/auth-states");

/**
 * Admin accounts default to their de-elevated identity. The shared E2E state
 * explicitly provisions the same prerequisites a verified factor creates,
 * then exercises the real elevation endpoint.
 */
async function elevateAdminSession(page: Page, baseURL: string, email: string): Promise<void> {
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
  const epoch = (await getRedis().get(keys.adminElevationEpoch(user.id))) ?? "0";
  await getRedis()
    .multi()
    .set(keys.apiTokenStepUp(session.id), "1", "EX", 600)
    .set(keys.adminSessionMfa(session.id), `${user.id}:${epoch}`, "EX", 600)
    .exec();

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
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:5173";
  await mkdir(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();

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

    await page.evaluate(() => localStorage.setItem("nojv:tour:off", "1"));

    const state = await context.storageState();
    // better-auth.session_data is a short-lived client cache. Keeping it makes
    // long E2E runs appear signed out as soon as that cache expires, despite a
    // still-valid session token. Let the server rebuild it from the token.
    state.cookies = state.cookies.filter(
      (cookie) => cookie.name !== "better-auth.session_data",
    );
    await writeFile(path.join(AUTH_DIR, `${role.name}.json`), JSON.stringify(state));
    await context.close();
  }

  await browser.close();
}
