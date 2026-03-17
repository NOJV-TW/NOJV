// tests/setup/playwright-global-setup.ts
import { chromium, type FullConfig } from "@playwright/test";
import path from "node:path";

const AUTH_DIR = path.resolve(import.meta.dirname, "../fixtures/auth-states");

const roles = [
  { name: "admin", email: "admin@nojv.local", password: "password123" },
  { name: "teacher", email: "teacher@nojv.local", password: "password123" },
  { name: "student", email: "student@nojv.local", password: "password123" }
] as const;

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:5173";
  const browser = await chromium.launch();

  await Promise.all(
    roles.map(async (role) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(`${baseURL}/signin`);
      await page.getByLabel(/email/i).fill(role.email);
      await page.getByLabel(/password/i).fill(role.password);
      await page.getByRole("button", { name: /sign in|登入/i }).click();
      await page.waitForURL("**/problems");

      await context.storageState({ path: path.join(AUTH_DIR, `${role.name}.json`) });
      await context.close();
    })
  );

  await browser.close();
}
