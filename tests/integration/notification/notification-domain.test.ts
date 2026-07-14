import { beforeEach, describe, expect, it } from "vitest";

import { NotificationDedupeConflictError, notificationRepo } from "@nojv/db";
import { notificationDomain } from "@nojv/application";
import { createSubscriber, keys } from "@nojv/redis";

import { createTestUser, testPrisma } from "../../fixtures/factories";
import { truncateTestTables } from "../../fixtures/seed-test-db";

describe("notificationDomain (real DB + Redis)", () => {
  beforeEach(async () => {
    await truncateTestTables(["DurableWork", "Notification"]);
  });

  it("writes a notification row", async () => {
    const user = await createTestUser();

    const notification = await notificationDomain.createNotification({
      userId: user.id,
      type: "course_enrolled",
      params: { courseSlug: "x", courseName: "X" },
      linkUrl: "/courses/x",
    });

    const rows = await notificationRepo.listRecent(user.id, 10);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.userId).toBe(user.id);
    expect(row.type).toBe("course_enrolled");
    expect(row.params).toEqual({ courseSlug: "x", courseName: "X" });
    expect(row.linkUrl).toBe("/courses/x");
    expect(row.readAt).toBeNull();
    const transportWork = await testPrisma.durableWork.findMany({
      where: { dedupeKey: notification.id },
      orderBy: { kind: "asc" },
    });
    expect(transportWork).toHaveLength(2);
    expect(transportWork.map(({ kind, status }) => ({ kind, status }))).toEqual([
      {
        kind: notificationDomain.NOTIFICATION_EMAIL_WORK_KIND,
        status: "pending",
      },
      {
        kind: notificationDomain.NOTIFICATION_SSE_WORK_KIND,
        status: "pending",
      },
    ]);
    expect(
      transportWork.every(({ payload }) => JSON.stringify(payload).includes(notification.id)),
    ).toBe(true);
    expect(JSON.stringify(transportWork[1].payload)).toContain(user.id);
  });

  it("accepts only canonical reuse of a notification dedupe key", async () => {
    const user = await createTestUser();
    const input = {
      userId: user.id,
      type: "course_enrolled" as const,
      params: { courseId: "course-1", courseName: "Algorithms" },
      linkUrl: "/courses/course-1",
      dedupeKey: `course-enrolled:${user.id}`,
    };

    const first = await notificationDomain.createNotification(input);
    const duplicate = await notificationDomain.createNotification(input);

    expect(duplicate.id).toBe(first.id);
    await expect(
      notificationDomain.createNotification({
        ...input,
        params: { courseId: "course-1", courseName: "Different" },
      }),
    ).rejects.toBeInstanceOf(NotificationDedupeConflictError);
    expect(await testPrisma.notification.count()).toBe(1);
    expect(await testPrisma.durableWork.count()).toBe(2);
  });

  it("caps retention at 50 per user", async () => {
    const user = await createTestUser();

    for (let i = 0; i < 55; i++) {
      await notificationDomain.createNotification({
        userId: user.id,
        type: "announcement_published",
        params: { ordinal: i },
        linkUrl: `/n/${String(i)}`,
      });
    }

    const rows = await notificationRepo.listRecent(user.id, 100);
    expect(rows).toHaveLength(50);

    const earliestParams = rows[rows.length - 1].params as { ordinal: number };
    expect(earliestParams.ordinal).toBeGreaterThanOrEqual(5);
  });

  it("publishes to the redis notification channel", async () => {
    const user = await createTestUser({ emailVerified: true });

    const sub = createSubscriber(process.env.REDIS_URL ?? "redis://localhost:6379");
    const received: string[] = [];
    sub.on("message", (_channel, message) => {
      received.push(message);
    });
    await sub.subscribe(keys.notificationChannel(user.id));

    try {
      const notification = await notificationDomain.createNotification({
        userId: user.id,
        type: "course_enrolled",
        params: { courseSlug: "algos", courseName: "Algorithms" },
        linkUrl: "/courses/algos",
      });
      const sseWork = await testPrisma.durableWork.findUniqueOrThrow({
        where: {
          kind_dedupeKey: {
            kind: notificationDomain.NOTIFICATION_SSE_WORK_KIND,
            dedupeKey: notification.id,
          },
        },
      });
      const emailWork = await testPrisma.durableWork.findUniqueOrThrow({
        where: {
          kind_dedupeKey: {
            kind: notificationDomain.NOTIFICATION_EMAIL_WORK_KIND,
            dedupeKey: notification.id,
          },
        },
      });
      await notificationDomain.deleteOne(user.id, notification.id);
      await notificationDomain.publishNotificationSse(
        sseWork.payload as unknown as notificationDomain.NotificationSseWorkPayload,
      );
      await expect(
        notificationDomain.deliverNotificationEmail(
          emailWork.payload as unknown as notificationDomain.NotificationEmailWorkPayload,
        ),
      ).resolves.toMatchObject({
        transport: "email",
        outcome: "suppressed",
        reason: "notification_missing",
      });

      const deadline = Date.now() + 1000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(received).toHaveLength(1);
      const event = JSON.parse(received[0]) as {
        type: string;
        notificationType: string;
        params: Record<string, unknown>;
        linkUrl: string | null;
        id: string;
        createdAt: string;
      };
      expect(event.type).toBe("notification");
      expect(event.notificationType).toBe("course_enrolled");
      expect(event.params).toEqual({ courseSlug: "algos", courseName: "Algorithms" });
      expect(event.linkUrl).toBe("/courses/algos");
      expect(event.id).toBeTruthy();
      expect(Number.isNaN(Date.parse(event.createdAt))).toBe(false);
    } finally {
      await sub.quit();
    }
  });

  it("resolves current recipient and preference state after enqueue", async () => {
    const user = await createTestUser({
      email: "enqueued@example.com",
      emailVerified: true,
    });
    const notification = await notificationDomain.createNotification({
      userId: user.id,
      type: "course_enrolled",
      params: { courseName: "Algorithms" },
      linkUrl: "/courses/algorithms",
    });
    const emailWork = await testPrisma.durableWork.findUniqueOrThrow({
      where: {
        kind_dedupeKey: {
          kind: notificationDomain.NOTIFICATION_EMAIL_WORK_KIND,
          dedupeKey: notification.id,
        },
      },
    });
    const payload =
      emailWork.payload as unknown as notificationDomain.NotificationEmailWorkPayload;
    expect(payload).not.toHaveProperty("to");

    await testPrisma.user.update({
      where: { id: user.id },
      data: { email: "current@example.com" },
    });
    const current = await notificationRepo.findEmailDeliveryContext(notification.id, user.id);
    expect(current.notification?.user.email).toBe("current@example.com");

    await notificationDomain.updateNotificationPreferences(user.id, {
      emailCourseEnrolled: false,
    });
    await expect(notificationDomain.deliverNotificationEmail(payload)).resolves.toEqual({
      transport: "email",
      outcome: "suppressed",
      reason: "preference_disabled",
    });

    await notificationDomain.updateNotificationPreferences(user.id, {
      emailCourseEnrolled: true,
    });
    await testPrisma.user.update({ where: { id: user.id }, data: { disabled: true } });
    await expect(notificationDomain.deliverNotificationEmail(payload)).resolves.toEqual({
      transport: "email",
      outcome: "suppressed",
      reason: "recipient_disabled",
    });
  });

  it("distinguishes notification deletion from account deletion at execution", async () => {
    const notificationOwner = await createTestUser({ emailVerified: true });
    const deletedNotification = await notificationDomain.createNotification({
      userId: notificationOwner.id,
      type: "course_enrolled",
      params: { courseName: "Algorithms" },
    });
    const notificationPayload = (
      await testPrisma.durableWork.findUniqueOrThrow({
        where: {
          kind_dedupeKey: {
            kind: notificationDomain.NOTIFICATION_EMAIL_WORK_KIND,
            dedupeKey: deletedNotification.id,
          },
        },
      })
    ).payload as unknown as notificationDomain.NotificationEmailWorkPayload;
    await notificationDomain.deleteOne(notificationOwner.id, deletedNotification.id);
    await expect(
      notificationDomain.deliverNotificationEmail(notificationPayload),
    ).resolves.toEqual({
      transport: "email",
      outcome: "suppressed",
      reason: "notification_missing",
    });

    const deletedAccount = await createTestUser({ emailVerified: true });
    const accountNotification = await notificationDomain.createNotification({
      userId: deletedAccount.id,
      type: "course_enrolled",
      params: { courseName: "Algorithms" },
    });
    const accountPayload = (
      await testPrisma.durableWork.findUniqueOrThrow({
        where: {
          kind_dedupeKey: {
            kind: notificationDomain.NOTIFICATION_EMAIL_WORK_KIND,
            dedupeKey: accountNotification.id,
          },
        },
      })
    ).payload as unknown as notificationDomain.NotificationEmailWorkPayload;
    await testPrisma.user.delete({ where: { id: deletedAccount.id } });
    await expect(notificationDomain.deliverNotificationEmail(accountPayload)).resolves.toEqual({
      transport: "email",
      outcome: "suppressed",
      reason: "missing_recipient",
    });
  });

  it("markAsRead is idempotent", async () => {
    const user = await createTestUser();

    await notificationDomain.createNotification({
      userId: user.id,
      type: "role_changed",
      params: { role: "teacher" },
      linkUrl: null,
    });
    const [created] = await notificationRepo.listRecent(user.id, 1);
    expect(created).toBeDefined();
    const notificationId = created.id;

    const firstCount = await notificationDomain.markAsRead(user.id, notificationId);
    expect(firstCount).toBe(1);

    const [afterFirst] = await notificationRepo.listRecent(user.id, 1);
    expect(afterFirst.readAt).toBeInstanceOf(Date);
    expect(afterFirst.readAt).not.toBeNull();

    const secondCount = await notificationDomain.markAsRead(user.id, notificationId);
    expect(secondCount).toBe(0);
  });

  it("markAllAsRead updates only unread rows", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    for (let i = 0; i < 3; i++) {
      await notificationDomain.createNotification({
        userId: userA.id,
        type: "announcement_published",
        params: { ordinal: i },
        linkUrl: `/a/${String(i)}`,
      });
    }

    const rowsA = await notificationRepo.listRecent(userA.id, 10);
    expect(rowsA).toHaveLength(3);
    await notificationDomain.markAsRead(userA.id, rowsA[0].id);

    await notificationDomain.createNotification({
      userId: userB.id,
      type: "announcement_published",
      params: { ordinal: 0 },
      linkUrl: "/b/0",
    });

    const updatedA = await notificationDomain.markAllAsRead(userA.id);
    expect(updatedA).toBe(2);

    const rowsB = await notificationRepo.listRecent(userB.id, 10);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].readAt).toBeNull();
  });
});
