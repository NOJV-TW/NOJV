import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { DisposableCredentialUser, psql, signInWithPassword } from "./_disposable-user";
import { activateTwoFactor, enrollTotp, nextTotp } from "./_two-factor";

test.describe.configure({ retries: 0 });
test.setTimeout(120_000);

const user = new DisposableCredentialUser("admin-mfa");

function redis(...args: string[]): string {
  return execFileSync("docker", ["exec", "nojv-redis-1", "redis-cli", ...args], {
    encoding: "utf8",
  }).trim();
}

test.beforeAll(() => {
  user.create({ platformRole: "admin" });
});

test.afterAll(() => {
  user.cleanup();
});

async function currentSessionId(page: import("@playwright/test").Page): Promise<string> {
  const session = (await (await page.request.get("/api/auth/get-session")).json()) as {
    session?: { id?: string };
  };
  const sessionId = session.session?.id;
  if (!sessionId) throw new Error("Could not resolve the current admin session.");
  return sessionId;
}

test("enrollment and concurrent admin elevation consume each TOTP exactly once", async ({
  page,
}) => {
  await signInWithPassword(page, user.email);
  await activateTwoFactor(page);
  const { secret, verificationCode } = await enrollTotp(page);

  const sessionId = await currentSessionId(page);
  const securityGeneration = psql(
    `SELECT "securityGeneration" FROM "User" WHERE id = '${user.id}';`,
  );
  const marker = `sg1:${user.id}:${securityGeneration}`;

  // Enrollment mutates the factor set. It must not turn the enrollment proof
  // into a post-mutation elevation grant.
  expect(redis("GET", `nojv:admin:mfa:${sessionId}`)).toBe("");
  expect(redis("GET", `nojv:apitoken:stepup:${sessionId}`)).toBe("");
  expect(redis("GET", `nojv:admin:mode:${sessionId}`)).toBe("");

  await page.goto("/account/api-tokens/verify?purpose=admin-mode");
  await expect(page).toHaveURL(/\/account\/api-tokens\/verify\?purpose=admin-mode$/);

  await page.locator('input[name="code"]').fill(verificationCode);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("alert")).toContainText("already used");
  await expect(page).toHaveURL(/\/account\/api-tokens\/verify\?purpose=admin-mode$/);

  const freshCode = await nextTotp(secret, verificationCode);
  const verificationPath = "/account/api-tokens/verify?purpose=admin-mode";
  const submissions = await Promise.all([
    page.request.post(verificationPath, {
      form: { code: freshCode, purpose: "admin-mode" },
      headers: {
        accept: "application/json",
        origin: "http://localhost:5173",
        "x-sveltekit-action": "true",
      },
      maxRedirects: 0,
    }),
    page.request.post(verificationPath, {
      form: { code: freshCode, purpose: "admin-mode" },
      headers: {
        accept: "application/json",
        origin: "http://localhost:5173",
        "x-sveltekit-action": "true",
      },
      maxRedirects: 0,
    }),
  ]);
  const results = (await Promise.all(submissions.map((response) => response.json()))) as Array<{
    type: string;
    status: number;
    location?: string;
  }>;

  expect(results.map(({ type, status }) => ({ type, status }))).toEqual(
    expect.arrayContaining([
      { type: "redirect", status: 303 },
      { type: "failure", status: 401 },
    ]),
  );
  expect(results.find((result) => result.type === "redirect")?.location).toBe("/admin");

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin(?:\/|$)/, { timeout: 15_000 });
  await expect(page.getByRole("main")).toBeVisible();

  expect(await currentSessionId(page)).toBe(sessionId);
  expect(redis("GET", `nojv:admin:mfa:${sessionId}`)).toBe(marker);
  expect(redis("GET", `nojv:admin:mode:${sessionId}`)).toBe(marker);
});
