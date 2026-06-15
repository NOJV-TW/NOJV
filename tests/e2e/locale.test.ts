import { test, expect } from "@playwright/test";

import { studentAuth } from "./_shared";

async function setLocaleCookie(
  context: import("@playwright/test").BrowserContext,
  locale: "en" | "zh-TW",
): Promise<void> {
  await context.addCookies([
    {
      name: "PARAGLIDE_LOCALE",
      value: locale,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Locale routing — en vs zh-TW", () => {
  test("default locale (en) renders English copy on the dashboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    await setLocaleCookie(context, "en");
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.getByText("Overview").first()).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  test("zh-TW cookie swaps the dashboard copy to traditional Chinese", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    await setLocaleCookie(context, "zh-TW");
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.getByText("總覽").first()).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  test("zh-TW cookie applies to /courses listing", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    await setLocaleCookie(context, "zh-TW");
    const page = await context.newPage();
    await page.goto("/courses");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Operating Systems Lab")).toBeVisible();
    await context.close();
  });

  test("zh-TW cookie applies to /contests listing", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    await setLocaleCookie(context, "zh-TW");
    const page = await context.newPage();
    await page.goto("/contests");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("auth gate still fires regardless of locale cookie", async ({ browser }) => {
    const context = await browser.newContext();
    await setLocaleCookie(context, "zh-TW");
    const page = await context.newPage();
    await page.goto("/problems");
    await expect(page).toHaveURL(/signin/);
    await context.close();
  });
});
