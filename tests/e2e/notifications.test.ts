import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";

import { apiWriteHeaders, formActionHeaders, studentAuth, teacherAuth } from "./_shared";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";

const testPrisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: resolveDestructiveTestDatabase("nojv_e2e_test"),
  }),
});

test.describe("Notifications API", () => {
  test.afterAll(async () => testPrisma.$disconnect());

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
      headers: formActionHeaders,
    });
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("legacy announcement notification opens its source dialog", async ({ browser }) => {
    const user = await testPrisma.user.findUniqueOrThrow({
      where: { email: "student@nojv.local" },
    });
    const announcement = await testPrisma.announcement.findFirstOrThrow({
      where: { courseId: null, status: "published" },
      include: { translations: true },
    });
    const title = announcement.translations[0]?.title;
    if (!title) throw new Error("Seeded announcement translation is required.");

    const notification = await testPrisma.notification.create({
      data: {
        userId: user.id,
        type: "announcement_published",
        params: {
          announcementId: announcement.id,
          titleEn: title,
          titleZhTw: title,
        },
        linkUrl: null,
      },
    });

    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    try {
      await page.goto("/courses");
      await page.getByRole("button", { name: "Notifications" }).click();
      await page
        .locator(`a[href="/?announcement=${encodeURIComponent(announcement.id)}"]`)
        .click();

      await expect(page).toHaveURL(`/?announcement=${encodeURIComponent(announcement.id)}`);
      await expect(
        page.getByRole("dialog").getByRole("heading", { name: title }),
      ).toBeVisible();
    } finally {
      await context.close();
      await testPrisma.notification.deleteMany({ where: { id: notification.id } });
    }
  });
});
