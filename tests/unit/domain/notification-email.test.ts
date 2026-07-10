import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail, findManyByUserIds, listEmailByIds } = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  findManyByUserIds: vi.fn(),
  listEmailByIds: vi.fn(),
}));

vi.mock("@nojv/mailer", () => ({
  getMailer: () => ({ sendEmail }),
  getAppBaseUrl: () => "https://nojv.tw",
  renderEmail: (content: unknown) => JSON.stringify(content),
}));

vi.mock("@nojv/redis", () => ({
  pubsub: {
    publishNotification: vi.fn(),
    publishNotificationBatchSignal: vi.fn(),
  },
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: {},
  contestRepo: {},
  courseMembershipRepo: {},
  examRepo: {},
  participationRepo: {},
  notificationRepo: {
    createAndCap: vi.fn(),
    createManyAndCap: vi.fn(),
    listExistingDedupeKeys: vi.fn(),
  },
  notificationPreferenceRepo: { findManyByUserIds },
  userRepo: { listEmailByIds },
}));

import { maybeSendEmails } from "../../../packages/application/src/notification/email";

const NO_SKIP: ReadonlySet<string> = new Set<string>();

function verifiedUser(id: string, email = `${id}@example.com`) {
  return { id, email, emailVerified: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyByUserIds.mockResolvedValue([]);
  listEmailByIds.mockResolvedValue([]);
  sendEmail.mockResolvedValue(undefined);
});

describe("maybeSendEmails", () => {
  it("does not send when the matching preference is disabled", async () => {
    findManyByUserIds.mockResolvedValue([{ userId: "u1", emailAssignmentStarted: false }]);
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      [
        {
          userId: "u1",
          type: "assignment_started",
          params: { title: "作業一" },
          linkUrl: "/assignments/a1",
        },
      ],
      NO_SKIP,
    );

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send when the dedupeKey was skipped in-app", async () => {
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      [
        {
          userId: "u1",
          type: "assignment_due_soon",
          params: { title: "作業一" },
          linkUrl: "/assignments/a1",
          dedupeKey: "assignment_due_soon:a1:u1",
        },
      ],
      new Set(["assignment_due_soon:a1:u1"]),
    );

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never sends for a type without an email spec (clarification_answered)", async () => {
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      [
        {
          userId: "u1",
          type: "clarification_answered",
          params: { questionPreview: "hi" },
          linkUrl: "/contests/c1",
        },
      ],
      NO_SKIP,
    );

    expect(sendEmail).not.toHaveBeenCalled();
    expect(findManyByUserIds).not.toHaveBeenCalled();
  });

  it("routes announcement preference by courseId presence", async () => {
    findManyByUserIds.mockResolvedValue([
      { userId: "u1", emailCourseAnnouncement: false, emailSystemAnnouncement: true },
    ]);
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      [
        {
          userId: "u1",
          type: "announcement_published",
          params: {
            announcementId: "an1",
            titleEn: "Course news",
            titleZhTw: "課程公告",
            courseId: "c1",
          },
          linkUrl: null,
        },
        {
          userId: "u1",
          type: "announcement_published",
          params: { announcementId: "an2", titleEn: "System news", titleZhTw: "系統公告" },
          linkUrl: null,
        },
      ],
      NO_SKIP,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "【NOJV】新公告：系統公告" }),
    );
  });

  it("skips unverified and placeholder emails", async () => {
    listEmailByIds.mockResolvedValue([
      verifiedUser("u1"),
      { id: "u2", email: "u2@example.com", emailVerified: false },
      { id: "u3", email: "placeholder+bob@placeholder.nojv.local", emailVerified: true },
      { id: "u4", email: "deleted+x@deleted.nojv.local", emailVerified: true },
    ]);

    await maybeSendEmails(
      ["u1", "u2", "u3", "u4"].map((userId) => ({
        userId,
        type: "course_enrolled" as const,
        params: { courseId: "c1", courseName: "演算法" },
        linkUrl: "/courses/c1",
      })),
      NO_SKIP,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "u1@example.com" }));
  });

  it("keeps sending when one email throws", async () => {
    listEmailByIds.mockResolvedValue([verifiedUser("u1"), verifiedUser("u2")]);
    sendEmail.mockRejectedValueOnce(new Error("smtp down"));

    await expect(
      maybeSendEmails(
        ["u1", "u2"].map((userId) => ({
          userId,
          type: "role_changed" as const,
          params: { oldRole: "student", newRole: "teacher" },
          linkUrl: "/account",
        })),
        NO_SKIP,
      ),
    ).resolves.toBeUndefined();

    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("assembles subject and absolute action url", async () => {
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      [
        {
          userId: "u1",
          type: "assignment_due_soon",
          params: { title: "作業一" },
          linkUrl: "/assignments/a1",
        },
      ],
      NO_SKIP,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(arg.to).toBe("u1@example.com");
    expect(arg.subject).toBe("【NOJV】作業「作業一」即將截止");
    expect(arg.html).toContain("https://nojv.tw/assignments/a1");
    expect(arg.html).toContain("前往查看");
  });

  it("uses the editorial title for editorial_removed", async () => {
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      [
        {
          userId: "u1",
          type: "editorial_removed",
          params: { problemId: "p1", title: "二分搜解法" },
          linkUrl: "/problems/p1",
        },
      ],
      NO_SKIP,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0] as { subject: string; html: string };
    expect(arg.subject).toBe("【NOJV】你的題解〈二分搜解法〉已被移除");
    expect(arg.html).toContain("二分搜解法");
  });

  it("uses the post title for post_removed and gates on emailEditorialRemoved", async () => {
    findManyByUserIds.mockResolvedValue([{ userId: "u1", emailEditorialRemoved: true }]);
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      [
        {
          userId: "u1",
          type: "post_removed",
          params: { problemId: "p1", title: "貪心解法" },
          linkUrl: "/problems/p1",
        },
      ],
      NO_SKIP,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0] as { subject: string; html: string };
    expect(arg.subject).toBe("【NOJV】你的文章〈貪心解法〉已被移除");
    expect(arg.html).toContain("文章已被移除");
    expect(arg.html).toContain("貪心解法");
  });

  it("uses the post title for comment_removed and respects a disabled emailEditorialRemoved", async () => {
    findManyByUserIds.mockResolvedValue([
      { userId: "u1", emailEditorialRemoved: true },
      { userId: "u2", emailEditorialRemoved: false },
    ]);
    listEmailByIds.mockResolvedValue([verifiedUser("u1"), verifiedUser("u2")]);

    await maybeSendEmails(
      ["u1", "u2"].map((userId) => ({
        userId,
        type: "comment_removed" as const,
        params: { problemId: "p1", postTitle: "貪心解法" },
        linkUrl: "/problems/p1",
      })),
      NO_SKIP,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(arg.to).toBe("u1@example.com");
    expect(arg.subject).toBe("【NOJV】你在〈貪心解法〉下的留言已被移除");
    expect(arg.html).toContain("留言已被移除");
  });

  it("escapes HTML in the body but leaves the subject as plain text", async () => {
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      [
        {
          userId: "u1",
          type: "assignment_started",
          params: { title: '<a href="evil">x</a>' },
          linkUrl: "/assignments/a1",
        },
      ],
      NO_SKIP,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0] as { subject: string; html: string };
    expect(arg.subject).toBe('【NOJV】作業「<a href="evil">x</a>」已開始');
    expect(arg.html).toContain("&lt;a href=&quot;evil&quot;&gt;x&lt;/a&gt;");
    expect(arg.html).not.toContain('<a href="evil">');
  });

  it("skips a wanted user missing from the email lookup", async () => {
    listEmailByIds.mockResolvedValue([verifiedUser("u1")]);

    await maybeSendEmails(
      ["u1", "u2"].map((userId) => ({
        userId,
        type: "course_enrolled" as const,
        params: { courseId: "c1", courseName: "演算法" },
        linkUrl: "/courses/c1",
      })),
      NO_SKIP,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "u1@example.com" }));
  });
});
