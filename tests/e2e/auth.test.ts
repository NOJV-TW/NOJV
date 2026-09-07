import { test, expect } from "@playwright/test";
import { studentAuth } from "./_shared";

test.describe("Authentication flow", () => {
  test("can view sign-in page", async ({ page }) => {
    await page.goto("/signin");
    await expect(page).toHaveTitle(/NOJV/);
  });

  test("redirects unauthenticated user to signin", async ({ page }) => {
    await page.goto("/problems");
    await expect(page).toHaveURL(/signin/);
  });

  test("account menu supports arrow navigation and Escape focus restoration", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    try {
      await page.goto("/dashboard");
      const trigger = page.getByRole("button", { name: /open account menu/i });
      await expect(trigger).toBeEnabled();
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("menu");
      const items = menu.getByRole("menuitem");
      await expect(menu).toBeInViewport();
      await expect(menu).not.toHaveAttribute("data-starting-style", "");
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press("End");
      await expect(items.last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await context.close();
    }
  });
});
