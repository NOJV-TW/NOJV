import { describe, expect, it } from "vitest";

import {
  ConflictError,
  examDomain,
  ForbiddenError,
  HttpError,
  NotFoundError,
  submissionDomain,
} from "@nojv/application";

import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const { session } = examDomain;

interface ActorOverrides {
  platformRole?: "student" | "teacher" | "admin";
}

async function buildActor(overrides: ActorOverrides = {}) {
  const user = await createTestUser({ platformRole: overrides.platformRole ?? "student" });
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    emailVerified: false,
    platformRole: user.platformRole as "student" | "teacher" | "admin",
  };
}

async function createCourseWithMember(
  userId: string,
  role: "student" | "teacher" | "ta" = "student",
) {
  const owner = await createTestUser({ platformRole: "teacher" });
  const course = await createTestCourse({ ownerId: owner.id });
  await testPrisma.courseMembership.create({
    data: {
      courseId: course.id,
      userId,
      role,
      status: "active",
      joinedAt: new Date(),
    },
  });
  return { course, owner };
}

function inWindow(now = new Date()) {
  return {
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 60 * 60_000),
  };
}

describe("examDomain.session — start", () => {
  it("creates a session for a course member when the exam is running", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });

    const result = await session.startSessionWithGate(actor, { examId: exam.id });

    expect(result.created).toBe(true);
    expect(result.session.examId).toBe(exam.id);
    expect(result.session.endedAt).toBeNull();
    expect(result.exam.endsAt).toEqual(exam.endsAt);

    const persisted = await testPrisma.activeExamSession.findFirst({
      where: { userId: actor.userId, examId: exam.id },
    });
    expect(persisted).not.toBeNull();
    expect(persisted!.endedAt).toBeNull();

    const events = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: persisted!.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("enter");
  });

  it("is idempotent — second call returns the same session and 200 created=false", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });

    const first = await session.startSessionWithGate(actor, { examId: exam.id });
    const second = await session.startSessionWithGate(actor, { examId: exam.id });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.session.id).toBe(first.session.id);

    const sessions = await testPrisma.activeExamSession.findMany({
      where: { userId: actor.userId, examId: exam.id },
    });
    expect(sessions).toHaveLength(1);

    const events = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: first.session.id, eventType: "enter" },
    });
    expect(events).toHaveLength(1);
  });

  it("throws ForbiddenError when the user is not an active course member", async () => {
    const actor = await buildActor();
    const owner = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: owner.id });
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });

    await expect(
      session.startSessionWithGate(actor, { examId: exam.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError when the exam is draft", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "draft",
      ...inWindow(),
    });

    await expect(
      session.startSessionWithGate(actor, { examId: exam.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws 410 HttpError when the exam has already ended", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const past = new Date(Date.now() - 60 * 60_000);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      startsAt: new Date(past.getTime() - 60 * 60_000),
      endsAt: past,
    });

    const err = await session
      .startSessionWithGate(actor, { examId: exam.id })
      .then(() => null)
      .catch((e) => e as unknown);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(410);
  });

  it("throws 410 HttpError when the exam start is more than the grace window away", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const startsAt = new Date(Date.now() + 60 * 60_000);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    });

    const err = await session
      .startSessionWithGate(actor, { examId: exam.id })
      .then(() => null)
      .catch((e) => e as unknown);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(410);
  });

  it("rejects starting inside the former five-minute pre-start window", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const startsAt = new Date(Date.now() + 2 * 60_000);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    });

    await expect(
      session.startSessionWithGate(actor, { examId: exam.id }),
    ).rejects.toMatchObject({ status: 410 });
    expect(await testPrisma.activeExamSession.count({ where: { examId: exam.id } })).toBe(0);
  });

  it("throws ConflictError when the user already has an active session on a different exam", async () => {
    const actor = await buildActor();
    const { course: courseA } = await createCourseWithMember(actor.userId);
    const { course: courseB } = await createCourseWithMember(actor.userId);

    const examA = await createTestExam({
      courseId: courseA.id,
      status: "published",
      ...inWindow(),
    });
    const examB = await createTestExam({
      courseId: courseB.id,
      status: "published",
      ...inWindow(),
    });

    await session.startSessionWithGate(actor, { examId: examA.id });

    await expect(
      session.startSessionWithGate(actor, { examId: examB.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("examDomain.session — end (submitted)", () => {
  it("ends the caller's own session and writes a release event", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });

    const { session: started } = await session.startSessionWithGate(actor, { examId: exam.id });

    const updated = await session.endSession(actor, {
      examId: exam.id,
      reason: "submitted",
    });

    expect(updated.id).toBe(started.id);
    expect(updated.endedAt).not.toBeNull();
    expect(updated.releaseReason).toBe("submitted");
    expect(
      await testPrisma.participation.findUnique({
        where: { type_examId_userId: { type: "exam", examId: exam.id, userId: actor.userId } },
      }),
    ).toMatchObject({ status: "submitted", submittedAt: updated.endedAt });
    await expect(session.startSessionWithGate(actor, { examId: exam.id })).rejects.toThrow(
      "You have already submitted this exam.",
    );
    await expect(
      session.requireActiveSessionForUserExam(actor.userId, exam.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const retried = await session.endSession(actor, { examId: exam.id, reason: "submitted" });
    expect(retried.endedAt).toEqual(updated.endedAt);
    expect(await session.getSessionState(actor.userId, exam.id)).toEqual({
      hasActiveSession: false,
      hasSubmitted: true,
    });

    const problem = await createTestProblem();
    await expect(
      submissionDomain.createQueuedSubmissionRecord(
        {
          problemId: problem.id,
          language: "cpp17",
          sourceCode: "int main() { return 0; }",
          context: { type: "exam", examId: exam.id },
          sampleOnly: false,
        },
        actor,
        "127.0.0.1",
      ),
    ).rejects.toThrow("An active session for this exam is required.");
    expect(
      await testPrisma.submission.count({ where: { userId: actor.userId, examId: exam.id } }),
    ).toBe(0);

    const events = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: started.id, eventType: "release" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({ reason: "submitted" });
  });

  it("keeps hand-in final when start and end requests overlap", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    await session.startSessionWithGate(actor, { examId: exam.id });

    const [ended] = await Promise.allSettled([
      session.endSession(actor, { examId: exam.id, reason: "submitted" }),
      session.startSessionWithGate(actor, { examId: exam.id }),
    ]);
    expect(ended.status).toBe("fulfilled");
    expect(await session.getActiveSessionContext(actor.userId)).toBeNull();
    await expect(session.startSessionWithGate(actor, { examId: exam.id })).rejects.toThrow(
      "You have already submitted this exam.",
    );
  });

  it("throws NotFoundError when a different student tries to end the wrong session", async () => {
    const ownerActor = await buildActor();
    const { course } = await createCourseWithMember(ownerActor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    await session.startSessionWithGate(ownerActor, { examId: exam.id });

    const otherActor = await buildActor();
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: otherActor.userId,
        role: "student",
        status: "active",
        joinedAt: new Date(),
      },
    });

    await expect(
      session.endSession(otherActor, { examId: exam.id, reason: "submitted" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("examDomain.session — end (released_by_instructor)", () => {
  it("allows a teacher to release a student's session", async () => {
    const teacherActor = await buildActor({ platformRole: "teacher" });
    const studentActor = await buildActor();
    const { course } = await createCourseWithMember(teacherActor.userId, "teacher");
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: studentActor.userId,
        role: "student",
        status: "active",
        joinedAt: new Date(),
      },
    });
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    const { session: started } = await session.startSessionWithGate(studentActor, {
      examId: exam.id,
    });

    const updated = await session.releaseSessionAsInstructor(teacherActor, {
      examId: exam.id,
      targetUserId: studentActor.userId,
    });

    expect(updated.id).toBe(started.id);
    expect(updated.endedAt).not.toBeNull();
    expect(updated.releaseReason).toBe("released_by_instructor");

    const events = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: started.id, eventType: "release" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({
      reason: "released_by_instructor",
      endedByUserId: teacherActor.userId,
    });
  });

  it("allows a TA to release a student's session", async () => {
    const taActor = await buildActor();
    const studentActor = await buildActor();
    const { course } = await createCourseWithMember(taActor.userId, "ta");
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: studentActor.userId,
        role: "student",
        status: "active",
        joinedAt: new Date(),
      },
    });
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    await session.startSessionWithGate(studentActor, { examId: exam.id });

    const updated = await session.releaseSessionAsInstructor(taActor, {
      examId: exam.id,
      targetUserId: studentActor.userId,
    });

    expect(updated.releaseReason).toBe("released_by_instructor");
    await expect(
      session.startSessionWithGate(studentActor, { examId: exam.id }),
    ).resolves.toMatchObject({
      session: { endedAt: null },
    });
    expect(await session.getSessionState(studentActor.userId, exam.id)).toEqual({
      hasActiveSession: true,
      hasSubmitted: false,
    });
  });

  it("finalizes hand-in from a stale tab after an instructor release", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });
    const student = await buildActor();
    const { course } = await createCourseWithMember(teacher.userId, "teacher");
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.userId, role: "student", status: "active" },
    });
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    await session.startSessionWithGate(student, { examId: exam.id });
    await session.releaseSessionAsInstructor(teacher, {
      examId: exam.id,
      targetUserId: student.userId,
    });

    await session.endSession(student, { examId: exam.id, reason: "submitted" });

    expect(await session.getSessionState(student.userId, exam.id)).toEqual({
      hasActiveSession: false,
      hasSubmitted: true,
    });
    await expect(session.startSessionWithGate(student, { examId: exam.id })).rejects.toThrow(
      "You have already submitted this exam.",
    );
  });

  it("throws ForbiddenError when a plain student tries to release another student's session", async () => {
    const studentA = await buildActor();
    const studentB = await buildActor();
    const { course } = await createCourseWithMember(studentA.userId, "student");
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: studentB.userId,
        role: "student",
        status: "active",
        joinedAt: new Date(),
      },
    });
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    await session.startSessionWithGate(studentB, { examId: exam.id });

    await expect(
      session.releaseSessionAsInstructor(studentA, {
        examId: exam.id,
        targetUserId: studentB.userId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError when the target has no active session", async () => {
    const teacherActor = await buildActor({ platformRole: "teacher" });
    const studentActor = await buildActor();
    const { course } = await createCourseWithMember(teacherActor.userId, "teacher");
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: studentActor.userId,
        role: "student",
        status: "active",
        joinedAt: new Date(),
      },
    });
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });

    await expect(
      session.releaseSessionAsInstructor(teacherActor, {
        examId: exam.id,
        targetUserId: studentActor.userId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("examDomain.session — student proctoring rows", () => {
  it("reports hand-in time, bound IP and page-lock leave attempts per student", async () => {
    const handedIn = await buildActor();
    const { course } = await createCourseWithMember(handedIn.userId);
    const working = await buildActor();
    await testPrisma.courseMembership.create({
      data: {
        courseId: course.id,
        userId: working.userId,
        role: "student",
        status: "active",
        joinedAt: new Date(),
      },
    });
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ipBindingEnabled: true,
      ...inWindow(),
    });

    await session.startSessionWithGate(handedIn, { examId: exam.id, ip: "203.0.113.4" });
    for (let i = 0; i < 2; i++)
      await session.recordEvent(handedIn, { examId: exam.id, eventType: "visibility_lost" });
    const ended = await session.endSession(handedIn, { examId: exam.id, reason: "submitted" });
    await session.startSessionWithGate(working, { examId: exam.id, ip: "203.0.113.5" });

    const rows = await session.listStudentProctoring(exam.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.userId === handedIn.userId)).toEqual({
      userId: handedIn.userId,
      submittedAt: ended.endedAt!.toISOString(),
      ipPin: "203.0.113.4",
      leaveAttempts: 2,
    });
    expect(rows.find((row) => row.userId === working.userId)).toEqual({
      userId: working.userId,
      submittedAt: null,
      ipPin: "203.0.113.5",
      leaveAttempts: 0,
    });
  });
});
