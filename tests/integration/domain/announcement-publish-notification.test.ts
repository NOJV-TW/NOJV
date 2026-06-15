import { describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { announcementDomain } from "@nojv/application";

import { createTestUser } from "../../fixtures/factories";

async function createActiveUsers(count: number) {
  const users = [];
  for (let i = 0; i < count; i++) {
    users.push(await createTestUser({ status: "active" }));
  }
  return users;
}

async function countNotificationsByType(userId: string, type: string) {
  const rows = await notificationRepo.listRecent(userId, 50);
  return rows.filter((r) => r.type === type).length;
}

describe("announcement publish fan-out", () => {
  it("writes announcement_published to every active user when created with published=true", async () => {
    const users = await createActiveUsers(3);

    const announcement = await announcementDomain.createAnnouncement({
      title: "Welcome to the platform",
      content: "Hello world",
      pinned: false,
      published: true,
    });

    for (const user of users) {
      const rows = await notificationRepo.listRecent(user.id, 10);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.type).toBe("announcement_published");
      expect(row.linkUrl).toBeNull();
      const params = row.params as {
        announcementId: string;
        titleEn: string;
        titleZhTw: string;
      };
      expect(params.announcementId).toBe(announcement.id);
      expect(params.titleEn).toBe("Welcome to the platform");
      expect(params.titleZhTw).toBe("Welcome to the platform");
    }
  });

  it("does NOT fan out when created as a draft", async () => {
    const users = await createActiveUsers(2);

    await announcementDomain.createAnnouncement({
      title: "Work in progress",
      content: "Not yet",
      pinned: false,
      published: false,
    });

    for (const user of users) {
      const rows = await notificationRepo.listRecent(user.id, 10);
      expect(rows).toHaveLength(0);
    }
  });

  it("fans out on draft → published update transition", async () => {
    const users = await createActiveUsers(2);

    const draft = await announcementDomain.createAnnouncement({
      title: "Coming soon",
      content: "Stay tuned",
      pinned: false,
      published: false,
    });
    for (const user of users) {
      expect(await countNotificationsByType(user.id, "announcement_published")).toBe(0);
    }

    await announcementDomain.updateAnnouncement(draft.id, {
      title: "Coming soon",
      content: "Stay tuned",
      pinned: false,
      published: true,
    });

    for (const user of users) {
      expect(await countNotificationsByType(user.id, "announcement_published")).toBe(1);
    }
  });

  it("does NOT re-fan-out when updating an already-published announcement", async () => {
    const users = await createActiveUsers(2);

    const published = await announcementDomain.createAnnouncement({
      title: "Hello",
      content: "World",
      pinned: false,
      published: true,
    });
    for (const user of users) {
      expect(await countNotificationsByType(user.id, "announcement_published")).toBe(1);
    }

    await announcementDomain.updateAnnouncement(published.id, {
      title: "Hello (edited)",
      content: "World",
      pinned: false,
      published: true,
    });

    for (const user of users) {
      expect(await countNotificationsByType(user.id, "announcement_published")).toBe(1);
    }
  });

  it("skips users whose status is not active", async () => {
    const active = await createTestUser({ status: "active" });
    const disabled = await createTestUser({ status: "disabled" });
    const pending = await createTestUser({ status: "pending_first_login" });

    await announcementDomain.createAnnouncement({
      title: "Active only",
      content: "x",
      pinned: false,
      published: true,
    });

    expect(await countNotificationsByType(active.id, "announcement_published")).toBe(1);
    expect(await countNotificationsByType(disabled.id, "announcement_published")).toBe(0);
    expect(await countNotificationsByType(pending.id, "announcement_published")).toBe(0);
  });

  it("toggleAnnouncementPublish fans out on draft → published", async () => {
    const users = await createActiveUsers(2);

    const draft = await announcementDomain.createAnnouncement({
      title: "Toggle title",
      content: "x",
      pinned: false,
      published: false,
    });
    for (const user of users) {
      expect(await countNotificationsByType(user.id, "announcement_published")).toBe(0);
    }

    await announcementDomain.toggleAnnouncementPublish(draft.id);

    for (const user of users) {
      expect(await countNotificationsByType(user.id, "announcement_published")).toBe(1);
    }

    await announcementDomain.toggleAnnouncementPublish(draft.id);
    for (const user of users) {
      expect(await countNotificationsByType(user.id, "announcement_published")).toBe(1);
    }
  });
});
