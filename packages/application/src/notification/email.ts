import { getAppBaseUrl, getMailer, renderEmail } from "@nojv/mailer";
import { notificationRepo, type NotificationCreateInput } from "@nojv/db";
import { DEFAULT_NOTIFICATION_PREFERENCES, notificationPreferencesSchema } from "@nojv/core";
import { z } from "zod";

type Params = Record<string, unknown>;

const NOTIFICATION_TYPES = [
  "assignment_started",
  "assignment_due_soon",
  "exam_starting_soon",
  "contest_starting_soon",
  "course_enrolled",
  "announcement_published",
  "role_changed",
  "clarification_answered",
  "editorial_removed",
  "post_removed",
  "comment_removed",
] as const satisfies readonly NotificationCreateInput["type"][];

const EMAIL_PREFERENCE_KEYS = [
  "emailAssignmentStarted",
  "emailAssignmentDueSoon",
  "emailExamStarting",
  "emailContestStarting",
  "emailSystemAnnouncement",
  "emailCourseAnnouncement",
  "emailCourseEnrolled",
  "emailRoleChanged",
  "emailEditorialRemoved",
] as const;

type NotificationEmailPreferenceKey = (typeof EMAIL_PREFERENCE_KEYS)[number];

interface EmailSpec {
  prefKey: (params: Params) => NotificationEmailPreferenceKey;
  subject: (params: Params) => string;
  heading: (params: Params) => string;
  intro: (params: Params) => string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value: unknown): string {
  return str(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function announcementTitle(params: Params): string {
  return str(params.titleZhTw) || str(params.titleEn);
}

const ROLE_LABELS: Record<string, { zh: string; en: string }> = {
  admin: { zh: "管理員", en: "Administrator" },
  teacher: { zh: "教師", en: "Teacher" },
  student: { zh: "學生", en: "Student" },
};

function roleLabel(role: string): { zh: string; en: string } {
  return ROLE_LABELS[role] ?? { zh: role, en: role };
}

const EMAIL_SPECS: Partial<Record<NotificationCreateInput["type"], EmailSpec>> = {
  assignment_started: {
    prefKey: () => "emailAssignmentStarted",
    subject: (p) => `【NOJV】作業「${str(p.title)}」已開始`,
    heading: () => "作業已開始 · Assignment started",
    intro: (p) =>
      `<p>作業「${esc(p.title)}」已開始，快去作答吧。</p><p>The assignment "${esc(p.title)}" has started.</p>`,
  },
  assignment_due_soon: {
    prefKey: () => "emailAssignmentDueSoon",
    subject: (p) => `【NOJV】作業「${str(p.title)}」即將截止`,
    heading: () => "作業即將截止 · Assignment due soon",
    intro: (p) =>
      `<p>作業「${esc(p.title)}」即將截止，別忘了在期限前完成。</p><p>The assignment "${esc(p.title)}" is due soon.</p>`,
  },
  exam_starting_soon: {
    prefKey: () => "emailExamStarting",
    subject: (p) => `【NOJV】考試「${str(p.title)}」即將開始`,
    heading: () => "考試即將開始 · Exam starting soon",
    intro: (p) =>
      `<p>考試「${esc(p.title)}」即將開始，請準時進入。</p><p>The exam "${esc(p.title)}" is starting soon.</p>`,
  },
  contest_starting_soon: {
    prefKey: () => "emailContestStarting",
    subject: (p) => `【NOJV】比賽「${str(p.title)}」即將開始`,
    heading: () => "比賽即將開始 · Contest starting soon",
    intro: (p) =>
      `<p>比賽「${esc(p.title)}」即將開始，做好準備！</p><p>The contest "${esc(p.title)}" is starting soon.</p>`,
  },
  announcement_published: {
    prefKey: (p) => (p.courseId ? "emailCourseAnnouncement" : "emailSystemAnnouncement"),
    subject: (p) => `【NOJV】新公告：${announcementTitle(p)}`,
    heading: () => "新公告 · New announcement",
    intro: (p) =>
      `<p>發布了一則新公告：${esc(announcementTitle(p))}</p><p>A new announcement was published: ${esc(announcementTitle(p))}</p>`,
  },
  course_enrolled: {
    prefKey: () => "emailCourseEnrolled",
    subject: (p) => `【NOJV】你已被加入課程「${str(p.courseName)}」`,
    heading: () => "你被加入了課程 · Added to a course",
    intro: (p) =>
      `<p>你已被加入課程「${esc(p.courseName)}」。</p><p>You have been added to the course "${esc(p.courseName)}".</p>`,
  },
  role_changed: {
    prefKey: () => "emailRoleChanged",
    subject: (p) => `【NOJV】你的權限已變更為${roleLabel(str(p.newRole)).zh}`,
    heading: () => "權限已變更 · Role changed",
    intro: (p) =>
      `<p>你的帳號權限已變更為${roleLabel(str(p.newRole)).zh}。</p><p>Your account role has been changed to ${roleLabel(str(p.newRole)).en}.</p>`,
  },
  editorial_removed: {
    prefKey: () => "emailEditorialRemoved",
    subject: (p) => `【NOJV】你的題解〈${str(p.title)}〉已被移除`,
    heading: () => "題解已被移除 · Editorial removed",
    intro: (p) =>
      `<p>你的題解〈${esc(p.title)}〉因檢舉經審核後已被移除。</p><p>Your editorial "${esc(p.title)}" has been removed after a report review.</p>`,
  },
  post_removed: {
    prefKey: () => "emailEditorialRemoved",
    subject: (p) => `【NOJV】你的文章〈${str(p.title)}〉已被移除`,
    heading: () => "文章已被移除 · Post removed",
    intro: (p) =>
      `<p>你的文章〈${esc(p.title)}〉因檢舉經審核後已被移除。</p><p>Your post "${esc(p.title)}" has been removed after a report review.</p>`,
  },
  comment_removed: {
    prefKey: () => "emailEditorialRemoved",
    subject: (p) => `【NOJV】你在〈${str(p.postTitle)}〉下的留言已被移除`,
    heading: () => "留言已被移除 · Comment removed",
    intro: (p) =>
      `<p>你在〈${esc(p.postTitle)}〉下的留言因檢舉經審核後已被移除。</p><p>Your comment on "${esc(p.postTitle)}" has been removed after a report review.</p>`,
  },
};

function isPlaceholderEmail(email: string): boolean {
  return email.endsWith("@placeholder.nojv.local") || email.endsWith("@deleted.nojv.local");
}

const PRE_DELIVERY_SUPPRESSION_REASONS = [
  "notification_missing",
  "missing_recipient",
  "recipient_disabled",
  "recipient_inactive",
  "unverified_recipient",
  "placeholder_recipient",
  "preference_disabled",
  "unsupported_notification_type",
] as const;

export type NotificationEmailSuppressionReason =
  (typeof PRE_DELIVERY_SUPPRESSION_REASONS)[number] | "mailer_suppressed";

const notificationEmailIdentitySchema = {
  notificationId: z.string().min(1),
  userId: z.string().min(1),
  notificationType: z.enum(NOTIFICATION_TYPES),
};

export const notificationEmailWorkPayloadSchema = z.discriminatedUnion("disposition", [
  z
    .object({
      ...notificationEmailIdentitySchema,
      disposition: z.literal("send"),
      preferenceKey: z.enum(EMAIL_PREFERENCE_KEYS),
      messageId: z.string().min(1),
      subject: z.string().min(1),
      html: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...notificationEmailIdentitySchema,
      disposition: z.literal("suppress"),
      reason: z.enum(PRE_DELIVERY_SUPPRESSION_REASONS),
    })
    .strict(),
]);

export type NotificationEmailWorkPayload = z.infer<typeof notificationEmailWorkPayloadSchema>;

export type NotificationEmailWorkResult =
  | {
      transport: "email";
      outcome: "accepted";
      deliverySemantics: "at_least_once";
      messageId: string;
    }
  | {
      transport: "email";
      outcome: "suppressed";
      reason: NotificationEmailSuppressionReason;
      messageId?: string;
    };

function suppressedEmailWork(
  notificationId: string,
  input: NotificationCreateInput,
  reason: Exclude<NotificationEmailSuppressionReason, "mailer_suppressed">,
): NotificationEmailWorkPayload {
  return {
    notificationId,
    userId: input.userId,
    notificationType: input.type,
    disposition: "suppress",
    reason,
  };
}

export function buildNotificationEmailWork(
  notificationId: string,
  input: NotificationCreateInput,
): NotificationEmailWorkPayload {
  const spec = EMAIL_SPECS[input.type];
  if (!spec) return suppressedEmailWork(notificationId, input, "unsupported_notification_type");

  const params = input.params as Params;
  const base = getAppBaseUrl();
  return {
    notificationId,
    userId: input.userId,
    notificationType: input.type,
    disposition: "send",
    preferenceKey: spec.prefKey(params),
    messageId: `<notification.${notificationId}@nojv.local>`,
    subject: spec.subject(params),
    html: renderEmail({
      heading: spec.heading(params),
      intro: spec.intro(params),
      ...(input.linkUrl
        ? { action: { url: `${base}${input.linkUrl}`, label: "前往查看 · View" } }
        : {}),
      outro: preferenceOutro(base),
    }),
  };
}

export async function deliverNotificationEmail(
  work: NotificationEmailWorkPayload,
): Promise<NotificationEmailWorkResult> {
  if (work.disposition === "suppress") {
    return { transport: "email", outcome: "suppressed", reason: work.reason };
  }
  const context = await notificationRepo.findEmailDeliveryContext(
    work.notificationId,
    work.userId,
  );
  if (!context.notification) {
    return {
      transport: "email",
      outcome: "suppressed",
      reason: context.recipientExists ? "notification_missing" : "missing_recipient",
    };
  }
  if (
    context.notification.userId !== work.userId ||
    context.notification.type !== work.notificationType
  ) {
    throw new Error(`Notification email work identity mismatch: ${work.notificationId}`);
  }

  const recipient = context.notification.user;
  if (recipient.disabled) {
    return { transport: "email", outcome: "suppressed", reason: "recipient_disabled" };
  }
  if (recipient.status !== "active") {
    return { transport: "email", outcome: "suppressed", reason: "recipient_inactive" };
  }
  if (!recipient.emailVerified) {
    return { transport: "email", outcome: "suppressed", reason: "unverified_recipient" };
  }
  if (isPlaceholderEmail(recipient.email)) {
    return { transport: "email", outcome: "suppressed", reason: "placeholder_recipient" };
  }
  const preferences = notificationPreferencesSchema.parse(
    recipient.notificationPreference ?? DEFAULT_NOTIFICATION_PREFERENCES,
  );
  if (!preferences[work.preferenceKey]) {
    return { transport: "email", outcome: "suppressed", reason: "preference_disabled" };
  }

  const delivery = await getMailer().sendEmail({
    to: recipient.email,
    subject: work.subject,
    html: work.html,
    messageId: work.messageId,
  });
  if (delivery === "suppressed") {
    return {
      transport: "email",
      outcome: "suppressed",
      reason: "mailer_suppressed",
      messageId: work.messageId,
    };
  }
  return {
    transport: "email",
    outcome: "accepted",
    deliverySemantics: "at_least_once",
    messageId: work.messageId,
  };
}

function preferenceOutro(base: string): string {
  const link = `${base}/settings`;
  return `不想收到這類信件嗎？請至<a href="${link}">設定頁面</a>調整通知偏好。<br>Manage your notification preferences in <a href="${link}">settings</a>.`;
}
