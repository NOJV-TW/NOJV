import { describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { announcementDomain, notificationDomain } from "@nojv/application";
import { getAppBaseUrl } from "@nojv/mailer";

import { createTestCourse, createTestUser, testPrisma } from "../../fixtures/factories";

async function createActiveUsers(count: number) {
  const users = [];
  for (let i = 0; i < count; i++) {
    users.push(await createTestUser());
  }
  return users;
}

async function countNotificationsByType(userId: string, type: string) {
  const rows = await notificationRepo.listRecent(userId, 50);
  return rows.filter((r) => r.type === type).length;
}

describe("announcement publish fan-out", () => {
  it("snapshots the announcement body and course name into the email work only", async () => {
    const admin = await createTestUser({ platformRole: "admin" });
    const course = await createTestCourse({ ownerId: admin.id, title: "演算法導論" });
    const member = await createTestUser();
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: member.id, role: "student" },
    });

    await announcementDomain.createAnnouncement({
      title: "期中考",
      content:
        "**10/20** 上午 9 點\n\n![座位表](/api/storage/user-content-images/u1/seats.png)",
      pinned: false,
      published: true,
      courseId: course.id,
    });

    const row = (await notificationRepo.listRecent(member.id, 10)).find(
      (item) => item.type === "announcement_published",
    );
    if (!row) throw new Error("Expected an announcement notification.");
    expect(row.params).toMatchObject({ courseId: course.id, courseName: "演算法導論" });
    expect(row.params).not.toHaveProperty("content");

    const emailWork = await testPrisma.durableWork.findUniqueOrThrow({
      where: {
        kind_dedupeKey: {
          kind: notificationDomain.NOTIFICATION_EMAIL_WORK_KIND,
          dedupeKey: row.id,
        },
      },
    });
    const payload = notificationDomain.notificationEmailWorkPayloadSchema.parse(
      emailWork.payload,
    );
    if (payload.disposition !== "send") throw new Error("Expected send work.");
    expect(payload.subject).toBe("【NOJV】演算法導論 課程公告：期中考");
    expect(payload.html).toContain("<strong>10/20</strong>");
    expect(payload.html).toContain(
      `<img src="${getAppBaseUrl()}/api/storage/user-content-images/u1/seats.png"`,
    );
    expect(payload.html).toContain("課程公告 · Course announcement");
  });

  it("keeps a teachers-only announcement away from students", async () => {
    const student = await createTestUser({ platformRole: "student" });
    const teacher = await createTestUser({ platformRole: "teacher" });
    const admin = await createTestUser({ platformRole: "admin" });

    await announcementDomain.createAnnouncement({
      title: "教師會議",
      content: "只有教師看得到的內容",
      pinned: false,
      published: true,
      audience: "teachers",
    });

    expect(await countNotificationsByType(student.id, "announcement_published")).toBe(0);
    expect(await countNotificationsByType(teacher.id, "announcement_published")).toBe(1);
    expect(await countNotificationsByType(admin.id, "announcement_published")).toBe(1);

    const emailWork = await testPrisma.durableWork.findMany({
      where: { kind: notificationDomain.NOTIFICATION_EMAIL_WORK_KIND },
    });
    expect(emailWork).toHaveLength(2);
    for (const work of emailWork) {
      expect(JSON.stringify(work.payload)).toContain("只有教師看得到的內容");
    }
    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("fans a students audience out to every role, matching the site listing", async () => {
    const student = await createTestUser({ platformRole: "student" });
    const teacher = await createTestUser({ platformRole: "teacher" });

    await announcementDomain.createAnnouncement({
      title: "學生公告",
      content: "x",
      pinned: false,
      published: true,
      audience: "students",
    });

    expect(await countNotificationsByType(student.id, "announcement_published")).toBe(1);
    expect(await countNotificationsByType(teacher.id, "announcement_published")).toBe(1);
  });

  it("filters course announcement recipients by audience too", async () => {
    const owner = await createTestUser({ platformRole: "admin" });
    const course = await createTestCourse({ ownerId: owner.id });
    const student = await createTestUser({ platformRole: "student" });
    const teacher = await createTestUser({ platformRole: "teacher" });
    await testPrisma.courseMembership.createMany({
      data: [
        { courseId: course.id, userId: student.id, role: "student" },
        { courseId: course.id, userId: teacher.id, role: "teacher" },
      ],
    });

    await announcementDomain.createAnnouncement({
      title: "課程教師公告",
      content: "教師限定",
      pinned: false,
      published: true,
      audience: "teachers",
      courseId: course.id,
    });

    expect(await countNotificationsByType(student.id, "announcement_published")).toBe(0);
    expect(await countNotificationsByType(teacher.id, "announcement_published")).toBe(1);
  });

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
      const row = rows[0];
      expect(row.type).toBe("announcement_published");
      expect(row.linkUrl).toBe(`/?announcement=${encodeURIComponent(announcement.id)}`);
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

  it("resolves the source link for legacy announcement notifications", async () => {
    const user = await createTestUser();
    const announcement = await announcementDomain.createAnnouncement({
      title: "Legacy link",
      content: "Existing notification",
      pinned: false,
      published: false,
    });

    const legacy = await notificationDomain.createNotification({
      userId: user.id,
      type: "announcement_published",
      params: {
        announcementId: announcement.id,
        titleEn: "Legacy link",
        titleZhTw: "Legacy link",
      },
      linkUrl: null,
      dedupeKey: `legacy-announcement:${user.id}`,
    });
    const malformed = await notificationDomain.createNotification({
      userId: user.id,
      type: "announcement_published",
      params: { announcementId: null },
      linkUrl: null,
      dedupeKey: `malformed-announcement:${user.id}`,
    });

    const rows = await notificationDomain.listRecent(user.id, 10);
    expect(rows.find((row) => row.id === legacy.id)?.linkUrl).toBe(
      `/?announcement=${encodeURIComponent(announcement.id)}`,
    );
    expect(rows.find((row) => row.id === malformed.id)?.linkUrl).toBeNull();
  });

  it("links course announcements for real members and skips pending roster entries", async () => {
    const admin = await createTestUser({ platformRole: "admin" });
    const course = await createTestCourse({ ownerId: admin.id });
    const member = await createTestUser();
    await testPrisma.courseMembership.createMany({
      data: [
        { courseId: course.id, userId: member.id, role: "student" },
        { courseId: course.id, pendingUsername: "pending_student", role: "student" },
      ],
    });

    await announcementDomain.createAnnouncement({
      title: "Course update",
      content: "New material",
      pinned: false,
      published: true,
      courseId: course.id,
    });

    const rows = await notificationRepo.listRecent(member.id, 10);
    const row = rows.find((item) => item.type === "announcement_published");
    expect(row?.linkUrl).toBe(`/courses/${encodeURIComponent(course.id)}`);
    await expect(
      testPrisma.notification.findMany({
        where: { type: "announcement_published" },
        select: { userId: true },
      }),
    ).resolves.toEqual([{ userId: member.id }]);
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

  it("serializes concurrent draft publications so only one request owns fan-out", async () => {
    const users = await createActiveUsers(3);
    const draft = await announcementDomain.createAnnouncement({
      title: "Publish once",
      content: "Concurrent publication",
      pinned: false,
      published: false,
    });
    const update = {
      title: "Publish once",
      content: "Concurrent publication",
      pinned: false,
      published: true,
    } as const;

    await Promise.all(
      Array.from({ length: 8 }, () => announcementDomain.updateAnnouncement(draft.id, update)),
    );

    for (const user of users) {
      expect(await countNotificationsByType(user.id, "announcement_published")).toBe(1);
    }
  });

  it("skips disabled users", async () => {
    const active = await createTestUser();
    const disabled = await createTestUser({ disabled: true });

    await announcementDomain.createAnnouncement({
      title: "Active only",
      content: "x",
      pinned: false,
      published: true,
    });

    expect(await countNotificationsByType(active.id, "announcement_published")).toBe(1);
    expect(await countNotificationsByType(disabled.id, "announcement_published")).toBe(0);
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
