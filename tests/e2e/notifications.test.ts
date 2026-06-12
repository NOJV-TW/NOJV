import { test, expect } from "@playwright/test";

import { apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

test.describe("Notifications API", () => {
  test("unauthenticated user cannot list recent notifications", async ({ page }) => {
    const res = await page.request.get(`/api/notifications`);
    expect(res.status()).toBe(401);
  });

  test("unauthenticated user cannot read unread count", async ({ page }) => {
    const res = await page.request.get(`/api/notifications/unread-count`);
    expect(res.status()).toBe(401);
  });

  test("authenticated student gets a well-shaped recent payload", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/notifications`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.unreadCount).toBe("number");
    expect(body.unreadCount).toBeGreaterThanOrEqual(0);
    await context.close();
  });

  test("limit query is clamped server-side", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/notifications?limit=999999`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeLessThanOrEqual(100);
    await context.close();
  });

  test("unread-count returns a number for an authenticated user", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/notifications/unread-count`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.count).toBe("number");
    await context.close();
  });

  test("read-all is idempotent and returns updated count", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.patch(`/api/notifications`, {
      headers: apiWriteHeaders,
      data: { action: "markAllRead" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.updated).toBe("number");
    expect(body.updated).toBeGreaterThanOrEqual(0);
    await context.close();
  });

  test("marking a nonexistent id as read is harmless", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.patch(`/api/notifications/nonexistent-id`, {
      headers: apiWriteHeaders,
      data: { read: true },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.updated).toBe(0);
    await context.close();
  });

  test("read-all rejects unauthenticated callers", async ({ page }) => {
    const res = await page.request.patch(`/api/notifications`, {
      headers: apiWriteHeaders,
      data: { action: "markAllRead" },
    });
    expect(res.status()).toBe(401);
  });

  test("CSRF gate blocks read-all without X-Requested-With", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.patch(`/api/notifications`, {
      data: { action: "markAllRead" },
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.status()).toBe(403);
    await context.close();
  });
});
