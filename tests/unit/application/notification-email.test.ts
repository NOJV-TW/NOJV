import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationCreateInput } from "@nojv/db";
import type { SendEmailInput, SendEmailResult } from "@nojv/mailer";

const { findEmailDeliveryContext, sendEmail } = vi.hoisted(() => ({
  findEmailDeliveryContext: vi.fn(),
  sendEmail: vi
    .fn<(input: SendEmailInput) => Promise<SendEmailResult>>()
    .mockResolvedValue("accepted"),
}));

vi.mock("@nojv/db", () => ({
  notificationRepo: { findEmailDeliveryContext },
}));

vi.mock("@nojv/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/mailer")>();
  return {
    ...actual,
    getMailer: () => ({ sendEmail }),
    getAppBaseUrl: () => "https://nojv.tw",
  };
});

import {
  buildNotificationEmailWork,
  deliverNotificationEmail,
  excerptMarkdown,
} from "../../../packages/application/src/notification/email";

function input(
  type: NotificationCreateInput["type"],
  params: NotificationCreateInput["params"],
): NotificationCreateInput {
  return { userId: "user-1", type, params, linkUrl: "/target" };
}

function currentContext(
  recipient: Partial<{
    email: string;
    emailVerified: boolean;
    disabled: boolean;
    notificationPreference: Record<string, unknown> | null;
  }> = {},
) {
  return {
    recipientExists: true,
    notification: {
      userId: "user-1",
      type: "course_enrolled",
      params: { courseName: "Algorithms" },
      user: {
        email: "student@example.com",
        emailVerified: true,
        disabled: false,
        notificationPreference: null,
        ...recipient,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findEmailDeliveryContext.mockResolvedValue(currentContext());
  sendEmail.mockResolvedValue("accepted");
});

describe("notification email durable delivery", () => {
  it.each([
    ["assignment_started", { title: "作業" }, "作業", "emailAssignmentStarted"],
    ["assignment_due_soon", { title: "作業" }, "作業", "emailAssignmentDueSoon"],
    ["exam_starting_soon", { title: "考試" }, "考試", "emailExamStarting"],
    ["contest_starting_soon", { title: "比賽" }, "比賽", "emailContestStarting"],
    ["announcement_published", { titleZhTw: "公告" }, "公告", "emailSystemAnnouncement"],
    ["course_enrolled", { courseName: "演算法" }, "演算法", "emailCourseEnrolled"],
    ["role_changed", { newRole: "teacher" }, "權限", "emailRoleChanged"],
    ["editorial_removed", { title: "題解" }, "題解", "emailEditorialRemoved"],
    ["post_removed", { title: "文章" }, "文章", "emailEditorialRemoved"],
    ["comment_removed", { postTitle: "文章" }, "文章", "emailEditorialRemoved"],
  ] as const)(
    "snapshots immutable content and event identity for supported type %s",
    (type, params, expectedText, preferenceKey) => {
      const work = buildNotificationEmailWork(`notification-${type}`, input(type, params));

      expect(work).toMatchObject({
        disposition: "send",
        userId: "user-1",
        notificationType: type,
        preferenceKey,
        messageId: `<notification.notification-${type}@nojv.local>`,
      });
      if (work.disposition !== "send") throw new Error("Expected send work.");
      expect(work).not.toHaveProperty("to");
      expect(work.subject).toContain(expectedText);
      expect(work.html).toContain("https://nojv.tw/target");
    },
  );

  it("records unsupported types as an explicit terminal suppression", async () => {
    const work = buildNotificationEmailWork(
      "unsupported",
      input("clarification_answered", { clarificationId: "clarification-1" }),
    );

    await expect(deliverNotificationEmail(work)).resolves.toEqual({
      transport: "email",
      outcome: "suppressed",
      reason: "unsupported_notification_type",
    });
    expect(findEmailDeliveryContext).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    [
      "notification deletion",
      { notification: null, recipientExists: true },
      "notification_missing",
    ],
    ["account deletion", { notification: null, recipientExists: false }, "missing_recipient"],
    ["account disable", currentContext({ disabled: true }), "recipient_disabled"],
    [
      "account anonymization",
      currentContext({ email: "deleted+user-1@deleted.nojv.local" }),
      "deleted_recipient",
    ],
    [
      "email verification revocation",
      currentContext({ emailVerified: false }),
      "unverified_recipient",
    ],
    [
      "preference opt-out",
      currentContext({ notificationPreference: { emailCourseEnrolled: false } }),
      "preference_disabled",
    ],
  ] as const)(
    "suppresses %s that occurs after enqueue and before delivery",
    async (_transition, context, reason) => {
      findEmailDeliveryContext.mockResolvedValue(context);
      const work = buildNotificationEmailWork(
        "notification-1",
        input("course_enrolled", { courseName: "Algorithms" }),
      );

      await expect(deliverNotificationEmail(work)).resolves.toEqual({
        transport: "email",
        outcome: "suppressed",
        reason,
      });
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );

  it.each(["current@example.com", "student@placeholder.nojv.local"])(
    "delivers to the real user's current verified address %s",
    async (email) => {
      findEmailDeliveryContext.mockResolvedValue(currentContext({ email }));
      const work = buildNotificationEmailWork(
        "notification-1",
        input("course_enrolled", { courseName: "Algorithms" }),
      );

      await expect(deliverNotificationEmail(work)).resolves.toMatchObject({
        outcome: "accepted",
        deliverySemantics: "at_least_once",
      });
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: email,
          messageId: "<notification.notification-1@nojv.local>",
        }),
      );
    },
  );

  it("rejects a durable payload whose immutable event identity does not match the row", async () => {
    findEmailDeliveryContext.mockResolvedValue({
      ...currentContext(),
      notification: { ...currentContext().notification, userId: "different-user" },
    });
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
    );

    await expect(deliverNotificationEmail(work)).rejects.toThrow(
      "Notification email work identity mismatch",
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("uses at-least-once SMTP delivery with a stable Message-ID across retries", async () => {
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
    );

    const first = await deliverNotificationEmail(work);
    const retryAfterAcceptanceBeforeCompletion = await deliverNotificationEmail(work);

    expect(first).toEqual({
      transport: "email",
      outcome: "accepted",
      deliverySemantics: "at_least_once",
      messageId: "<notification.notification-1@nojv.local>",
    });
    expect(retryAfterAcceptanceBeforeCompletion).toEqual(first);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ messageId: "<notification.notification-1@nojv.local>" }),
    );
    expect(sendEmail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ messageId: "<notification.notification-1@nojv.local>" }),
    );
  });

  it("persists mailer suppression as a distinct result", async () => {
    sendEmail.mockResolvedValue("suppressed");
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
    );

    await expect(deliverNotificationEmail(work)).resolves.toEqual({
      transport: "email",
      outcome: "suppressed",
      reason: "mailer_suppressed",
      messageId: "<notification.notification-1@nojv.local>",
    });
  });

  it("propagates SMTP failure for database-owned retry", async () => {
    sendEmail.mockRejectedValue(new Error("smtp down"));
    const work = buildNotificationEmailWork(
      "notification-1",
      input("course_enrolled", { courseName: "Algorithms" }),
    );

    await expect(deliverNotificationEmail(work)).rejects.toThrow("smtp down");
  });

  it("escapes HTML body content while keeping the plain-text subject", () => {
    const work = buildNotificationEmailWork(
      "notification-1",
      input("assignment_started", { title: '<a href="evil">x</a>' }),
    );

    if (work.disposition !== "send") throw new Error("Expected send work.");
    expect(work.subject).toContain('<a href="evil">x</a>');
    expect(work.html).toContain("&lt;a href=&quot;evil&quot;&gt;x&lt;/a&gt;");
    expect(work.html).not.toContain('<a href="evil">');
  });
});

describe("announcement email content", () => {
  const params = {
    announcementId: "a1",
    titleEn: "期中考公告",
    titleZhTw: "期中考公告",
    courseId: "c1",
    courseName: "演算法",
  };
  const emailParams = {
    content:
      "## 時間\n\n**10/20** 上午 9 點\n\n![座位表](/api/storage/user-content-images/u1/seats.png)\n\n<script>alert(1)</script>",
    courseName: "演算法",
    publishedAt: "2026-09-01T13:31:00.000Z",
  };

  function sendWork(work: ReturnType<typeof buildNotificationEmailWork>) {
    if (work.disposition !== "send") throw new Error("Expected send work.");
    return work;
  }

  it("snapshots the rendered body, course name, date, and preheader into the email", () => {
    const work = sendWork(
      buildNotificationEmailWork("n1", input("announcement_published", params), {
        emailParams,
      }),
    );

    expect(work.subject).toBe("【NOJV】演算法 課程公告：期中考公告");
    expect(work.preferenceKey).toBe("emailCourseAnnouncement");
    expect(work.html).toContain("課程公告 · Course announcement");
    expect(work.html).toContain("演算法 · 2026/09/01");
    expect(work.html).toContain("<strong>10/20</strong>");
    expect(work.html).toContain(
      '<img src="https://nojv.tw/api/storage/user-content-images/u1/seats.png" alt="座位表"',
    );
    expect(work.html).not.toContain("<script>");
    expect(work.html).toContain("&lt;script&gt;");
    expect(work.html).toContain("閱讀完整公告");
    expect(work.html).toContain("https://nojv.tw/target");
    expect(work.html).not.toContain("發布了一則新公告");
    expect(work.html.indexOf("時間 10/20 上午 9 點")).toBeLessThan(work.html.indexOf("<h2"));
  });

  it("falls back to the title-only intro for notifications without a content snapshot", () => {
    const work = sendWork(
      buildNotificationEmailWork(
        "n1",
        input("announcement_published", { announcementId: "a1", titleZhTw: "舊公告" }),
      ),
    );

    expect(work.subject).toBe("【NOJV】公告：舊公告");
    expect(work.preferenceKey).toBe("emailSystemAnnouncement");
    expect(work.html).toContain("系統公告 · System announcement");
    expect(work.html).toContain("發布了一則新公告：舊公告");
  });

  it("truncates long bodies at a paragraph boundary and keeps the read-more button", () => {
    const paragraph = "段落內容".repeat(50);
    const content = Array.from({ length: 20 }, (_, i) => `${String(i)} ${paragraph}`).join(
      "\n\n",
    );
    const work = sendWork(
      buildNotificationEmailWork("n1", input("announcement_published", params), {
        emailParams: { ...emailParams, content },
      }),
    );

    expect(work.html).toContain("0 段落內容");
    expect(work.html).not.toContain("19 段落內容");
    expect(work.html).toContain("…");
    expect(work.html).toContain("閱讀完整公告");
  });

  it("escapes the announcement title in the heading while keeping the subject plain", () => {
    const work = sendWork(
      buildNotificationEmailWork(
        "n1",
        input("announcement_published", { announcementId: "a1", titleZhTw: "<b>x</b>" }),
        { emailParams: { content: "hi", courseName: null, publishedAt: "" } },
      ),
    );

    expect(work.subject).toBe("【NOJV】公告：<b>x</b>");
    expect(work.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(work.html).not.toContain("<b>x</b>");
    expect(work.html).toContain(
      '<p style="margin:0 0 20px;font-size:13px;color:#5f6875">NOJV</p>',
    );
  });
});

describe("excerptMarkdown", () => {
  it("returns short markdown unchanged", () => {
    expect(excerptMarkdown("short", 100)).toBe("short");
  });

  it("cuts at the last paragraph break before the limit", () => {
    const markdown = `${"a".repeat(60)}\n\n${"b".repeat(60)}\n\n${"c".repeat(60)}`;
    expect(excerptMarkdown(markdown, 150)).toBe(`${"a".repeat(60)}\n\n${"b".repeat(60)}\n\n…`);
  });

  it("falls back to a word boundary when there is no paragraph break", () => {
    const markdown = `${"word ".repeat(40)}tail`;
    const excerpt = excerptMarkdown(markdown, 100);
    expect(excerpt.endsWith("\n\n…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(103);
  });
});
