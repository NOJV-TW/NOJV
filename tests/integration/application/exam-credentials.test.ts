import { beforeEach, describe, expect, it, vi } from "vitest";
import { examDomain, ForbiddenError } from "@nojv/application";
import { durableWorkRepo } from "@nojv/db";
import {
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@nojv/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nojv/mailer")>()),
  getMailer: () => ({ sendEmail }),
  getAppBaseUrl: () => "https://example.test",
}));

const password = "SyntheticExamPassword24";

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue("accepted");
});

async function classroom(startsInMs = 60_000, emailVerified = true) {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const student = await createTestUser({ emailVerified });
  const course = await createTestCourse({ ownerId: teacher.id });
  await testPrisma.courseMembership.createMany({
    data: [
      { courseId: course.id, userId: teacher.id, role: "teacher" },
      { courseId: course.id, userId: student.id, role: "student" },
    ],
  });
  const exam = await createTestExam({
    courseId: course.id,
    startsAt: new Date(Date.now() + startsInMs),
    endsAt: new Date(Date.now() + startsInMs + 3_600_000),
  });
  const actor = {
    userId: teacher.id,
    username: teacher.username!,
    displayName: teacher.name,
    email: teacher.email,
    platformRole: "teacher" as const,
  };
  return { actor, student, exam, course };
}

function credential(examId: string, userId: string) {
  return testPrisma.examCredential.findUniqueOrThrow({
    where: { examId_userId: { examId, userId } },
  });
}

async function signInSession(studentId: string, examId: string) {
  const row = await credential(examId, studentId);
  const session = await testPrisma.session.create({
    data: {
      id: `credential-session-${row.id}`,
      token: `credential-token-${row.id}`,
      userId: studentId,
      examPassword: true,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  expect(
    await examDomain.credentials.attachSession({
      credentialId: row.id,
      userId: studentId,
      revision: row.revision,
      sessionId: session.id,
    }),
  ).toBe(true);
  return session;
}

describe("exam credential lifecycle", () => {
  it("enforces secret cleanup and positive revisions in PostgreSQL", async () => {
    const { actor, student, exam } = await classroom();
    await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
    const row = await credential(exam.id, student.id);
    await expect(
      testPrisma.examCredential.update({ where: { id: row.id }, data: { revision: 0 } }),
    ).rejects.toThrow();
    await expect(
      testPrisma.examCredential.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      }),
    ).rejects.toThrow();
    expect((await credential(exam.id, student.id)).revision).toBe(1);
  });
  it("issues once for the full linked roster and catches late students without sending mail inline", async () => {
    const { actor, student, exam, course } = await classroom();
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, pendingUsername: "unlinked_student", role: "student" },
    });
    await examDomain.credentials.reconcile();
    const first = await credential(exam.id, student.id);
    await examDomain.credentials.reconcile();
    expect((await credential(exam.id, student.id)).revision).toBe(first.revision);
    const late = await createTestUser({ emailVerified: true });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: late.id, role: "student" },
    });
    await examDomain.credentials.reconcile();
    expect(await testPrisma.examCredential.count({ where: { examId: exam.id } })).toBe(2);
    expect(await testPrisma.participation.count({ where: { examId: exam.id } })).toBe(0);
    const entries = await examDomain.credentials.list(actor, exam.id);
    expect(entries.find((entry) => entry.username === "unlinked_student")).toMatchObject({
      password: null,
      status: "pending_account",
    });
    const entry = entries.find((row) => row.userId === student.id)!;
    expect(entry.password).toHaveLength(16);
    expect(first.passwordCiphertext).not.toContain(entry.password);
    expect(first.passwordHash).not.toContain(entry.password);
    const work = await testPrisma.durableWork.findMany({
      where: { kind: examDomain.credentials.EMAIL_WORK_KIND },
    });
    expect(work).toHaveLength(2);
    expect(work[0]?.payload).toEqual({ credentialId: first.id, revision: first.revision });
    expect(JSON.stringify(work)).not.toContain(entry.password);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps a teacher-selected password inactive before 24 hours and catches a schedule moved earlier", async () => {
    const { actor, student, exam } = await classroom(2 * 86_400_000);
    await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
    expect(await examDomain.credentials.authenticate(student.username!, password)).toBeNull();
    const before = await credential(exam.id, student.id);
    expect((await examDomain.credentials.list(actor, exam.id))[0]).toMatchObject({
      password,
      status: "ready",
    });
    expect(
      await examDomain.credentials.deliverEmail({
        credentialId: before.id,
        revision: before.revision,
      }),
    ).toEqual({ outcome: "obsolete" });
    await testPrisma.exam.update({
      where: { id: exam.id },
      data: { startsAt: new Date(Date.now() + 60_000) },
    });
    await examDomain.credentials.reconcile();
    const after = await credential(exam.id, student.id);
    expect(after.revision).toBe(before.revision);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(
      await examDomain.credentials.authenticate(student.username!, password),
    ).toMatchObject({ examId: exam.id });
    expect(
      await testPrisma.durableWork.count({
        where: { kind: examDomain.credentials.EMAIL_WORK_KIND },
      }),
    ).toBe(2);
  });

  it("uses the security mailbox, suppresses stale revisions, and never logs raw transport errors", async () => {
    const { actor, student, exam } = await classroom();
    await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
    const old = await credential(exam.id, student.id);
    await examDomain.credentials.setPassword(
      actor,
      exam.id,
      student.id,
      "SyntheticReplacedPassword24",
    );
    expect(
      await examDomain.credentials.deliverEmail({
        credentialId: old.id,
        revision: old.revision,
      }),
    ).toEqual({ outcome: "obsolete" });
    expect(sendEmail).not.toHaveBeenCalled();
    const current = await credential(exam.id, student.id);
    await examDomain.credentials.deliverEmail({
      credentialId: current.id,
      revision: current.revision,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: student.email,
        html: expect.stringContaining("SyntheticReplacedPassword24"),
      }),
    );
    sendEmail.mockRejectedValue(new Error(`unsafe transport diagnostic ${password}`));
    await expect(
      examDomain.credentials.deliverEmail({
        credentialId: current.id,
        revision: current.revision,
      }),
    ).rejects.toThrow("Exam credential email delivery failed.");
    expect((await credential(exam.id, student.id)).emailStatus).toBe("failed");
  });

  it("reenqueues a processed schedule after the start time changes A to B to A", async () => {
    const { actor, student, exam } = await classroom(3_600_000);
    await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
    const initial = await credential(exam.id, student.id);
    const [claimed] = await durableWorkRepo.claimBatch({
      kinds: [examDomain.credentials.EMAIL_WORK_KIND],
      owner: "schedule-test",
      limit: 1,
      now: new Date(),
      leaseDurationMs: 60_000,
    });
    expect(claimed).toBeDefined();
    await examDomain.credentials.deliverEmail({
      credentialId: initial.id,
      revision: initial.revision,
    });
    await durableWorkRepo.complete({
      id: claimed!.id,
      owner: "schedule-test",
      attempt: claimed!.attempt,
      now: new Date(),
    });
    await testPrisma.exam.update({
      where: { id: exam.id },
      data: { startsAt: new Date(exam.startsAt.getTime() + 60_000) },
    });
    await examDomain.credentials.reconcile();
    await testPrisma.exam.update({ where: { id: exam.id }, data: { startsAt: exam.startsAt } });
    await expect(examDomain.credentials.reconcile()).resolves.toMatchObject({ issued: 1 });
    await expect(examDomain.credentials.reconcile()).resolves.toMatchObject({ issued: 0 });
    const work = await testPrisma.durableWork.findMany({
      where: { kind: examDomain.credentials.EMAIL_WORK_KIND },
    });
    expect(work).toHaveLength(3);
    expect(new Set(work.map((row) => row.dedupeKey)).size).toBe(3);
    expect(
      work.filter((row) => row.availableAt.getTime() === exam.startsAt.getTime() - 86_400_000),
    ).toHaveLength(2);
    expect((await credential(exam.id, student.id)).revision).toBe(initial.revision);
  });

  it("compares the complete Unicode password beyond bcrypt's 72-byte boundary", async () => {
    const { actor, student, exam } = await classroom();
    const prefix = "測".repeat(24);
    await examDomain.credentials.setPassword(actor, exam.id, student.id, `${prefix}A`);
    expect(
      await examDomain.credentials.authenticate(student.username!, `${prefix}A`),
    ).toMatchObject({ examId: exam.id });
    expect(
      await examDomain.credentials.authenticate(student.username!, `${prefix}B`),
    ).toBeNull();
  });

  it("resumes email after mailbox verification without rotating passwords or active sessions", async () => {
    const { actor, student, exam } = await classroom(60_000, false);
    await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
    const before = await credential(exam.id, student.id);
    const session = await signInSession(student.id, exam.id);
    expect(
      await examDomain.credentials.deliverEmail({
        credentialId: before.id,
        revision: before.revision,
      }),
    ).toEqual({ outcome: "unavailable" });
    expect(sendEmail).not.toHaveBeenCalled();
    await testPrisma.user.update({ where: { id: student.id }, data: { emailVerified: true } });
    await examDomain.credentials.reconcile();
    expect((await credential(exam.id, student.id)).revision).toBe(before.revision);
    expect(await testPrisma.session.findUnique({ where: { id: session.id } })).not.toBeNull();
    expect(
      await testPrisma.durableWork.count({
        where: { kind: examDomain.credentials.EMAIL_WORK_KIND },
      }),
    ).toBe(2);
  });

  it("does not repeatedly reissue sink-suppressed emails or revoke their sessions", async () => {
    const { actor, student, exam } = await classroom();
    await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
    const before = await credential(exam.id, student.id);
    const session = await signInSession(student.id, exam.id);
    sendEmail.mockResolvedValue("suppressed");
    await examDomain.credentials.deliverEmail({
      credentialId: before.id,
      revision: before.revision,
    });
    await examDomain.credentials.reconcile();
    await examDomain.credentials.reconcile();
    expect((await credential(exam.id, student.id)).revision).toBe(before.revision);
    expect(await testPrisma.session.findUnique({ where: { id: session.id } })).not.toBeNull();
    expect(
      await testPrisma.durableWork.count({
        where: { kind: examDomain.credentials.EMAIL_WORK_KIND },
      }),
    ).toBe(1);
  });

  it("revokes only password-derived sessions and destroys secret material after an exam ends", async () => {
    const { actor, student, exam } = await classroom();
    await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
    const temporary = await signInSession(student.id, exam.id);
    const ordinary = await testPrisma.session.create({
      data: {
        id: `ordinary-${student.id}`,
        token: `ordinary-token-${student.id}`,
        userId: student.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await testPrisma.exam.update({
      where: { id: exam.id },
      data: { startsAt: new Date(Date.now() - 120_000), endsAt: new Date(Date.now() - 60_000) },
    });
    expect(await examDomain.credentials.validateSession(temporary.id)).toMatchObject({
      kind: "exam",
      valid: false,
    });
    await examDomain.credentials.reconcile();
    expect(await testPrisma.session.findUnique({ where: { id: temporary.id } })).toBeNull();
    expect(await testPrisma.session.findUnique({ where: { id: ordinary.id } })).not.toBeNull();
    expect(await credential(exam.id, student.id)).toMatchObject({
      passwordHash: null,
      passwordCiphertext: null,
      revokedAt: expect.any(Date),
    });
    expect((await examDomain.credentials.list(actor, exam.id))[0]).toMatchObject({
      password: null,
      status: "expired",
    });
  });

  it("keeps overlapping exam passwords independent", async () => {
    const { actor, student, exam, course } = await classroom();
    const second = await createTestExam({
      courseId: course.id,
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
    });
    await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
    await examDomain.credentials.setPassword(
      actor,
      second.id,
      student.id,
      "SyntheticSecondPassword24",
    );
    const firstSession = await signInSession(student.id, exam.id);
    const secondSession = await signInSession(student.id, second.id);
    await examDomain.credentials.setPassword(
      actor,
      exam.id,
      student.id,
      "SyntheticFirstRotated24",
    );
    expect(await testPrisma.session.findUnique({ where: { id: firstSession.id } })).toBeNull();
    expect(await examDomain.credentials.validateSession(secondSession.id)).toMatchObject({
      valid: true,
    });
    expect(
      await examDomain.credentials.authenticate(student.username!, "SyntheticSecondPassword24"),
    ).toMatchObject({ examId: second.id });
  });

  it("denies outsiders and excludes students who are staff in another course", async () => {
    const { actor, student, exam } = await classroom();
    const outsider = { ...actor, userId: student.id, platformRole: "student" as const };
    await expect(examDomain.credentials.list(outsider, exam.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      examDomain.credentials.setPassword(outsider, exam.id, student.id, password),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTestCourse();
    await testPrisma.courseMembership.create({
      data: { courseId: other.id, userId: student.id, role: "ta" },
    });
    await examDomain.credentials.reconcile();
    expect(await testPrisma.examCredential.count({ where: { examId: exam.id } })).toBe(0);
    await expect(
      examDomain.credentials.setPassword(actor, exam.id, student.id, password),
    ).rejects.toThrow("active, linked student account");
    expect((await examDomain.credentials.list(actor, exam.id))[0]).toMatchObject({
      password: null,
      status: "unavailable",
    });
  });
});
