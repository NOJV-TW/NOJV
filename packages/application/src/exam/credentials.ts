import {
  generateRandomString,
  hashPassword,
  symmetricDecrypt,
  symmetricEncrypt,
  verifyPassword,
} from "better-auth/crypto";
import {
  examCredentialEmailPayloadSchema,
  examCredentialPasswordSchema,
  type ExamCredentialEntry,
} from "@nojv/core";
import {
  courseRepo,
  durableWorkRepo,
  examCredentialRepo,
  examRepo,
  runTransaction,
  type ExamCredentialRecord,
  type TransactionClient,
} from "@nojv/db";
import { getAppBaseUrl, getMailer, renderEmail, validateMailerConfig } from "@nojv/mailer";

import { lockCourseForStaffMutation } from "../course/problem-library";
import type { ActorContext } from "../shared/actor-context";
import {
  ConfigurationError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { isCourseStaffTx } from "../shared/permissions";

export const EMAIL_WORK_KIND = "exam.credential.email";
export const VALID_BEFORE_START_MS = 86_400_000;

function encryptionKey(): string {
  const key = process.env.BETTER_AUTH_SECRET;
  if (!key || key.length < 32)
    throw new ConfigurationError("BETTER_AUTH_SECRET is required for exam credentials.");
  return key;
}

function eligible(record: ExamCredentialRecord, now: Date): boolean {
  return (
    record.exam.examPasswordEnabled &&
    record.exam.status === "published" &&
    record.exam.endsAt > now &&
    !record.exam.course.archived &&
    !record.user.disabled &&
    !record.user.isSuperAdmin &&
    record.user.platformRole === "student" &&
    record.user.username !== null &&
    !record.user.courseMemberships.some(
      (membership) =>
        membership.status === "active" &&
        (membership.role === "teacher" || membership.role === "ta"),
    ) &&
    record.user.courseMemberships.some(
      (membership) =>
        membership.courseId === record.exam.courseId &&
        membership.role === "student" &&
        membership.status === "active",
    )
  );
}

export function isUsable(record: ExamCredentialRecord, now = new Date()): boolean {
  return (
    eligible(record, now) &&
    record.revokedAt === null &&
    record.passwordHash !== null &&
    Math.min(
      record.exam.startsAt.getTime() - VALID_BEFORE_START_MS,
      record.exam.examPasswordLockedAt?.getTime() ?? Number.POSITIVE_INFINITY,
    ) <= now.getTime()
  );
}

async function material(password: string) {
  return {
    passwordHash: await hashPassword(password),
    passwordCiphertext: await symmetricEncrypt({ key: encryptionKey(), data: password }),
  };
}

async function enqueueEmail(
  tx: TransactionClient,
  credential: { id: string; revision: number },
  exam: { startsAt: Date; scheduleRevision: number },
  reason = "scheduled",
) {
  await durableWorkRepo.withTx(tx).enqueue({
    kind: EMAIL_WORK_KIND,
    dedupeKey: `${credential.id}:${String(credential.revision)}:${String(exam.scheduleRevision)}:${reason}`,
    payload: { credentialId: credential.id, revision: credential.revision },
    availableAt: new Date(exam.startsAt.getTime() - VALID_BEFORE_START_MS),
  });
}

async function removeCredentialSessions(tx: TransactionClient, credentialId: string) {
  await tx.session.deleteMany({ where: { examCredential: { credentialId } } });
}

async function issue(
  examId: string,
  userId: string,
  password: string,
  actor?: ActorContext,
): Promise<void> {
  const encrypted = await material(password);
  await runTransaction(async (tx) => {
    const scope = await tx.exam.findUnique({
      where: { id: examId },
      select: { courseId: true },
    });
    if (!scope) throw new NotFoundError("Exam not found.");
    if (actor) await lockCourseForStaffMutation(tx, actor, scope.courseId);
    else await courseRepo.withTx(tx).lockForUpdate(scope.courseId);
    await examRepo.withTx(tx).lockForUpdate(examId);
    const exam = await tx.exam.findUniqueOrThrow({
      where: { id: examId },
      include: { course: true },
    });
    const now = new Date();
    if (exam.status !== "published" || exam.endsAt <= now || exam.course.archived) {
      if (actor)
        throw new ValidationError(
          "Passwords can only be managed for published, unended exams.",
        );
      return;
    }
    if (!exam.examPasswordEnabled) {
      if (actor) throw new ValidationError("Temporary exam password sign-in is disabled.");
      return;
    }
    if (!actor && exam.startsAt.getTime() - VALID_BEFORE_START_MS > now.getTime()) return;
    const member = await tx.courseMembership.findFirst({
      where: {
        courseId: exam.courseId,
        userId,
        role: "student",
        status: "active",
        user: {
          disabled: false,
          isSuperAdmin: false,
          platformRole: "student",
          username: { not: null },
          courseMemberships: { none: { status: "active", role: { in: ["teacher", "ta"] } } },
        },
      },
    });
    if (!member) {
      if (actor)
        throw new ValidationError("The student must have an active, linked student account.");
      return;
    }
    await tx.$queryRaw`SELECT id FROM "ExamCredential" WHERE "examId" = ${examId} AND "userId" = ${userId} FOR UPDATE`;
    const previous = await tx.examCredential.findUnique({
      where: { examId_userId: { examId, userId } },
    });
    const emailScheduledFor = new Date(exam.startsAt.getTime() - VALID_BEFORE_START_MS);
    if (!actor && previous?.revokedAt === null) {
      if (
        !exam.examPasswordLockedAt &&
        previous.emailScheduledFor.getTime() !== emailScheduledFor.getTime()
      ) {
        await tx.examCredential.update({
          where: { id: previous.id },
          data: { emailScheduledFor, emailStatus: "pending", emailSentAt: null },
        });
        await enqueueEmail(tx, previous, exam);
      } else if (previous.emailStatus === "unverified") {
        const recipient = await tx.user.findUnique({
          where: { id: userId },
          select: { emailVerified: true },
        });
        if (recipient?.emailVerified) {
          await tx.examCredential.update({
            where: { id: previous.id },
            data: { emailStatus: "pending" },
          });
          await enqueueEmail(tx, previous, exam, "verified");
        }
      }
      return;
    }
    if (previous) await removeCredentialSessions(tx, previous.id);
    const credential = await tx.examCredential.upsert({
      where: { examId_userId: { examId, userId } },
      create: { examId, userId, emailScheduledFor, ...encrypted },
      update: {
        ...encrypted,
        emailScheduledFor,
        revision: { increment: 1 },
        revokedAt: null,
        emailSentAt: null,
        emailStatus: "pending",
      },
    });
    await enqueueEmail(tx, credential, exam);
  });
}

export async function setPassword(
  actor: ActorContext,
  examId: string,
  userId: string,
  password: string,
): Promise<void> {
  const parsed = examCredentialPasswordSchema.safeParse(password);
  if (!parsed.success)
    throw new ValidationError("Temporary passwords must contain 12 to 64 characters.");
  await issue(examId, userId, parsed.data, actor);
}

export async function list(
  actor: ActorContext,
  examId: string,
): Promise<ExamCredentialEntry[]> {
  const { exam, members, credentials } = await runTransaction(async (tx) => {
    const exam = await tx.exam.findUnique({ where: { id: examId }, include: { course: true } });
    if (!exam) throw new NotFoundError("Exam not found.");
    if (
      actor.platformRole !== "admin" &&
      !(await isCourseStaffTx(tx, actor.userId, exam.courseId))
    ) {
      throw new ForbiddenError(
        "Only course teachers and teaching assistants can view exam passwords.",
      );
    }
    const [members, credentials] = await Promise.all([
      tx.courseMembership.findMany({
        where: { courseId: exam.courseId, role: "student", status: "active" },
        include: {
          user: {
            include: {
              courseMemberships: {
                where: { status: "active", role: { in: ["teacher", "ta"] } },
                select: { id: true },
              },
            },
          },
        },
        orderBy: [{ user: { username: "asc" } }, { pendingUsername: "asc" }],
      }),
      tx.examCredential.findMany({ where: { examId } }),
    ]);
    return { exam, members, credentials };
  });
  const byUser = new Map(credentials.map((credential) => [credential.userId, credential]));
  const now = new Date();
  return Promise.all(
    members.map(async (member): Promise<ExamCredentialEntry> => {
      const credential = member.userId ? byUser.get(member.userId) : undefined;
      const user = member.user;
      const unavailable =
        user !== null &&
        (user.disabled ||
          user.isSuperAdmin ||
          user.platformRole !== "student" ||
          user.courseMemberships.length > 0);
      const expired =
        !exam.examPasswordEnabled ||
        exam.endsAt <= now ||
        exam.status !== "published" ||
        exam.course.archived ||
        credential?.revokedAt != null;
      const canReveal = !expired && !unavailable && credential?.passwordCiphertext;
      let status: ExamCredentialEntry["status"];
      if (!user?.username) status = "pending_account";
      else if (unavailable) status = "unavailable";
      else if (!exam.examPasswordEnabled) status = "not_issued";
      else if (exam.endsAt <= now || credential?.revokedAt != null) status = "expired";
      else if (!credential) status = "not_issued";
      else if (credential.emailStatus === "sent") status = "email_sent";
      else if (credential.emailStatus === "failed") status = "email_failed";
      else if (
        credential.emailStatus === "unavailable" ||
        credential.emailStatus === "unverified"
      )
        status = "email_unavailable";
      else
        status =
          exam.startsAt.getTime() - VALID_BEFORE_START_MS > now.getTime()
            ? "ready"
            : "email_pending";
      return {
        membershipId: member.id,
        userId: member.userId,
        username: user?.username ?? member.pendingUsername ?? "",
        name: user?.name ?? member.pendingUsername ?? "",
        email: user?.email ?? null,
        password: canReveal
          ? await symmetricDecrypt({ key: encryptionKey(), data: canReveal })
          : null,
        status,
        emailSentAt: credential?.emailSentAt?.toISOString() ?? null,
        revision: credential?.revision ?? null,
      };
    }),
  );
}

export interface AuthenticatedExamCredential {
  credentialId: string;
  revision: number;
  userId: string;
  examId: string;
  expiresAt: Date;
}

export async function authenticate(
  username: string,
  password: string,
): Promise<AuthenticatedExamCredential | null> {
  if (!examCredentialPasswordSchema.safeParse(password).success) return null;
  const records = await examCredentialRepo.findForUsername(
    username.trim().toLowerCase(),
    new Date(),
  );
  for (const record of records) {
    if (!isUsable(record) || !record.passwordHash) continue;
    if (await verifyPassword({ password, hash: record.passwordHash })) {
      return {
        credentialId: record.id,
        revision: record.revision,
        userId: record.userId,
        examId: record.examId,
        expiresAt: record.exam.endsAt,
      };
    }
  }
  if (records.length === 0) await hashPassword(password);
  return null;
}

export async function attachSession(
  input: Omit<AuthenticatedExamCredential, "examId" | "expiresAt"> & { sessionId: string },
): Promise<boolean> {
  return runTransaction(async (tx) => {
    const repo = examCredentialRepo.withTx(tx);
    await repo.lock(input.credentialId);
    const record = await repo.findById(input.credentialId);
    const session = await tx.session.findUnique({ where: { id: input.sessionId } });
    if (
      !record ||
      !session ||
      !session.examPassword ||
      session.userId !== input.userId ||
      record.userId !== input.userId ||
      record.revision !== input.revision ||
      !isUsable(record)
    )
      return false;
    await tx.examCredentialSession.create({
      data: {
        sessionId: input.sessionId,
        credentialId: input.credentialId,
        revision: input.revision,
        securityGeneration: record.user.securityGeneration,
      },
    });
    await tx.session.update({
      where: { id: input.sessionId },
      data: {
        expiresAt:
          record.exam.endsAt < session.expiresAt ? record.exam.endsAt : session.expiresAt,
      },
    });
    return true;
  });
}

export type ExamSessionValidation =
  { kind: "ordinary" } | { kind: "exam"; valid: boolean; examId: string; expiresAt: Date };

export async function validateSession(sessionId: string): Promise<ExamSessionValidation> {
  const session = await examCredentialRepo.findSession(sessionId);
  if (!session?.examPassword) return { kind: "ordinary" };
  const attachment = session.examCredential;
  if (!attachment)
    return { kind: "exam", valid: false, examId: "", expiresAt: session.expiresAt };
  const credential = attachment.credential;
  return {
    kind: "exam",
    examId: credential.examId,
    expiresAt: credential.exam.endsAt,
    valid:
      attachment.revision === credential.revision &&
      attachment.securityGeneration === credential.user.securityGeneration &&
      session.userId === credential.userId &&
      isUsable(credential),
  };
}

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => replacements[character] ?? character);
}

export async function deliverEmail(payload: unknown) {
  const { credentialId, revision } = examCredentialEmailPayloadSchema.parse(payload);
  const initial = await examCredentialRepo.findById(credentialId);
  if (
    initial?.revision !== revision ||
    !isUsable(initial) ||
    !initial.passwordCiphertext ||
    (initial.emailStatus === "sent" && initial.emailSentAt !== null)
  ) {
    return { outcome: "obsolete" };
  }
  const prepared = await runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Exam" WHERE id = ${initial.examId} FOR UPDATE`;
    const [exam, credential] = await Promise.all([
      tx.exam.findUnique({ where: { id: initial.examId } }),
      examCredentialRepo.withTx(tx).findById(credentialId),
    ]);
    if (
      !exam?.examPasswordEnabled ||
      credential?.revision !== revision ||
      credential.passwordCiphertext !== initial.passwordCiphertext ||
      !isUsable(credential) ||
      (credential.emailStatus === "sent" && credential.emailSentAt !== null)
    ) {
      return { outcome: "obsolete" as const };
    }
    if (
      !credential.user.emailVerified ||
      credential.user.email.endsWith("@deleted.nojv.local")
    ) {
      const outcome = credential.user.emailVerified ? "unavailable" : "unverified";
      await tx.examCredential.updateMany({
        where: { id: credentialId, revision },
        data: { emailStatus: outcome },
      });
      return { outcome: "unavailable" as const };
    }
    return { outcome: "ready" as const, credential };
  });
  if (prepared.outcome !== "ready") return { outcome: prepared.outcome };
  const { credential } = prepared;
  if (!credential.passwordCiphertext) return { outcome: "obsolete" };
  const mailerConfig = validateMailerConfig();
  const mailer = getMailer();
  const recipient = credential.user;
  try {
    const password = await symmetricDecrypt({
      key: encryptionKey(),
      data: credential.passwordCiphertext,
    });
    const html = renderEmail({
      heading: "考試臨時登入 · Temporary exam sign-in",
      intro: `<p>考試：${escapeHtml(credential.exam.title)}</p><p>帳號 Username: <strong>${escapeHtml(recipient.username ?? "")}</strong><br>臨時密碼 Temporary password: <strong>${escapeHtml(password)}</strong></p><p>有效期限 Valid until: ${escapeHtml(credential.exam.endsAt.toISOString())}</p>`,
      action: { url: `${getAppBaseUrl()}/signin`, label: "前往登入 · Sign in" },
      outro:
        "此密碼於考試結束後失效。請勿轉寄或分享。<br>This password expires when the exam ends. Do not share it.",
    });
    const sendable = await runTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Exam" WHERE id = ${credential.examId} FOR UPDATE`;
      const [exam, latest] = await Promise.all([
        tx.exam.findUnique({ where: { id: credential.examId } }),
        examCredentialRepo.withTx(tx).findById(credentialId),
      ]);
      if (
        !exam?.examPasswordEnabled ||
        latest?.revision !== revision ||
        latest.passwordCiphertext !== credential.passwordCiphertext ||
        !isUsable(latest) ||
        (latest.emailStatus === "sent" && latest.emailSentAt !== null)
      ) {
        return "obsolete" as const;
      }
      if (!latest.user.emailVerified || latest.user.email.endsWith("@deleted.nojv.local")) {
        await tx.examCredential.updateMany({
          where: { id: credentialId, revision },
          data: { emailStatus: latest.user.emailVerified ? "unavailable" : "unverified" },
        });
        return "unavailable" as const;
      }
      if (mailerConfig.MAILER_MODE === "smtp") {
        await tx.exam.update({
          where: { id: credential.examId },
          data: { examPasswordLockedAt: exam.examPasswordLockedAt ?? new Date() },
        });
      }
      return "ready" as const;
    });
    if (sendable !== "ready") return { outcome: sendable };
    const delivery = await mailer.sendEmail({
      to: recipient.email,
      messageId: `<exam-credential.${credentialId}.${String(revision)}@nojv.local>`,
      subject: `【NOJV】考試「${credential.exam.title}」臨時登入密碼`,
      html,
    });
    await runTransaction((tx) =>
      tx.examCredential.updateMany({
        where: { id: credentialId, revision, revokedAt: null },
        data: {
          emailStatus: delivery === "accepted" ? "sent" : "unavailable",
          ...(delivery === "accepted" ? { emailSentAt: new Date() } : {}),
        },
      }),
    );
    return { outcome: delivery };
  } catch {
    await runTransaction((tx) =>
      tx.examCredential.updateMany({
        where: { id: credentialId, revision },
        data: { emailStatus: "failed" },
      }),
    );
    throw new Error("Exam credential email delivery failed.");
  }
}

export async function reconcile(): Promise<{ issued: number; revoked: number }> {
  const now = new Date();
  const invalid = await examCredentialRepo.listInvalidCredentials(now);
  let revoked = 0;
  for (const { id } of invalid) {
    await runTransaction(async (tx) => {
      const repo = examCredentialRepo.withTx(tx);
      await repo.lock(id);
      const record = await repo.findById(id);
      if (record?.revokedAt !== null || eligible(record, new Date())) return;
      await removeCredentialSessions(tx, id);
      await tx.examCredential.update({
        where: { id },
        data: { revokedAt: new Date(), passwordHash: null, passwordCiphertext: null },
      });
      revoked += 1;
    });
  }
  const recipients = await examCredentialRepo.listDueRecipients(now);
  for (const recipient of recipients)
    await issue(
      recipient.examId,
      recipient.userId,
      generateRandomString(16, "a-z", "A-Z", "0-9"),
    );
  return { issued: recipients.length, revoked };
}
