import { test, expect } from "@playwright/test";
import path from "node:path";

import { apiWriteHeaders } from "./_shared";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("Problems", () => {
  test("can browse problem list as authenticated user", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/problems");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("can view problem detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/problems/problem_warmup-sum");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("mobile statement dialog traps and restores keyboard focus", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: studentAuth,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/problems/problem_warmup-sum", { waitUntil: "networkidle" });

    const trigger = page.getByRole("button", { name: /view statement/i });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Warmup Sum" });
    const close = dialog.getByRole("button", { name: /close statement/i });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await context.close();
  });

  test("teacher can create a problem via API and access edit page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post("/api/problems", { headers: apiWriteHeaders });
    expect(res.ok()).toBe(true);
    const { id } = await res.json();
    expect(id).toBeTruthy();
    await page.goto(`/problems/${id}/edit`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });
});
