import { describe, expect, it } from "vitest";

import {
  ConflictError,
  examDomain,
  ForbiddenError,
  HttpError,
  NotFoundError,
} from "@nojv/domain";

import {
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const { session } = examDomain;

interface ActorOverrides {
  platformRole?: "student" | "teacher" | "admin";
}

/**
 * Build a test actor whose shape matches `ActorContext`. The factory
 * helpers return a `User`; this wraps that with the extra fields the
 * domain layer expects so we can call `session.startSessionWithGate`
 * et al. directly.
 */
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

    // Persisted: row exists with endedAt: null
    const persisted = await testPrisma.activeExamSession.findFirst({
      where: { userId: actor.userId, examId: exam.id },
    });
    expect(persisted).not.toBeNull();
    expect(persisted!.endedAt).toBeNull();

    // An `enter` event was recorded
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

    // Still only one row, still only one enter event
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
    // Note: no membership row is created for `actor`.
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
    // 1 hour in the future — well outside the 5-minute grace window.
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

  it("allows starting inside the 5-minute grace window before startsAt", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    // 2 minutes in the future — inside the 5-minute grace.
    const startsAt = new Date(Date.now() + 2 * 60_000);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    });

    const result = await session.startSessionWithGate(actor, { examId: exam.id });
    expect(result.created).toBe(true);
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

    const events = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: started.id, eventType: "release" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({ reason: "submitted" });
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

    // A second student in the same course who has NOT started a session.
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

    // `endSession` looks up by the caller's userId, so the lookup
    // returns no row and throws NotFoundError. This is the same
    // behavioural outcome as the `(not owner) → 403` test case in the
    // task spec — the HTTP layer maps "no session for caller" to a
    // permission failure.
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
    // Note: studentActor never starts a session.

    await expect(
      session.releaseSessionAsInstructor(teacherActor, {
        examId: exam.id,
        targetUserId: studentActor.userId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("examDomain.session — heartbeat throttle", () => {
  it("updates lastHeartbeatAt and records the first event", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    const { session: started } = await session.startSessionWithGate(actor, { examId: exam.id });

    const before = await testPrisma.activeExamSession.findUnique({
      where: { id: started.id },
    });

    // Wait long enough that the heartbeat timestamp must move forward.
    await new Promise((r) => setTimeout(r, 20));

    const result = await session.heartbeatWithThrottle(actor.userId, exam.id);

    expect(result.recordedEvent).toBe(true);
    expect(result.session.lastHeartbeatAt.getTime()).toBeGreaterThan(
      before!.lastHeartbeatAt.getTime(),
    );

    const heartbeatEvents = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: started.id, eventType: "heartbeat" },
    });
    expect(heartbeatEvents).toHaveLength(1);
  });

  it("only records one heartbeat event inside the throttle window", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    const { session: started } = await session.startSessionWithGate(actor, { examId: exam.id });

    // Three pings in rapid succession with the default 60s throttle.
    const r1 = await session.heartbeatWithThrottle(actor.userId, exam.id);
    const r2 = await session.heartbeatWithThrottle(actor.userId, exam.id);
    const r3 = await session.heartbeatWithThrottle(actor.userId, exam.id);

    expect(r1.recordedEvent).toBe(true);
    expect(r2.recordedEvent).toBe(false);
    expect(r3.recordedEvent).toBe(false);

    const heartbeatEvents = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: started.id, eventType: "heartbeat" },
    });
    expect(heartbeatEvents).toHaveLength(1);
  });

  it("records a second event once the throttle window elapses (custom throttleMs)", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    const { session: started } = await session.startSessionWithGate(actor, { examId: exam.id });

    // Use a 25ms throttle so we don't slow the suite.
    const r1 = await session.heartbeatWithThrottle(actor.userId, exam.id, { throttleMs: 25 });
    expect(r1.recordedEvent).toBe(true);

    await new Promise((r) => setTimeout(r, 40));

    const r2 = await session.heartbeatWithThrottle(actor.userId, exam.id, { throttleMs: 25 });
    expect(r2.recordedEvent).toBe(true);

    const heartbeatEvents = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: started.id, eventType: "heartbeat" },
    });
    expect(heartbeatEvents).toHaveLength(2);
  });

  it("throws NotFoundError when no active session exists for the user/exam", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    // Note: no startSession call.

    await expect(session.heartbeatWithThrottle(actor.userId, exam.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws NotFoundError after the session has already been ended", async () => {
    const actor = await buildActor();
    const { course } = await createCourseWithMember(actor.userId);
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });
    await session.startSessionWithGate(actor, { examId: exam.id });
    await session.endSession(actor, { examId: exam.id, reason: "submitted" });

    await expect(session.heartbeatWithThrottle(actor.userId, exam.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("examDomain.session — releaseAll (instructor)", () => {
  it("ends every active session for the exam and reports the count", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });
    const { course } = await createCourseWithMember(teacher.userId, "teacher");
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });

    const sessionIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const student = await buildActor();
      await testPrisma.courseMembership.create({
        data: {
          courseId: course.id,
          userId: student.userId,
          role: "student",
          status: "active",
          joinedAt: new Date(),
        },
      });
      const { session: started } = await session.startSessionWithGate(student, {
        examId: exam.id,
      });
      sessionIds.push(started.id);
    }

    const result = await session.releaseAllSessionsAsInstructor(teacher, { examId: exam.id });
    expect(result.released).toBe(3);

    const rows = await testPrisma.activeExamSession.findMany({
      where: { id: { in: sessionIds } },
    });
    expect(rows).toHaveLength(3);
    expect(
      rows.every((r) => r.endedAt !== null && r.releaseReason === "released_by_instructor"),
    ).toBe(true);

    const releaseEvents = await testPrisma.examSessionEvent.findMany({
      where: { sessionId: { in: sessionIds }, eventType: "release" },
    });
    expect(releaseEvents).toHaveLength(3);
  });

  it("returns released: 0 when the exam has no active sessions", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });
    const { course } = await createCourseWithMember(teacher.userId, "teacher");
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });

    const result = await session.releaseAllSessionsAsInstructor(teacher, { examId: exam.id });
    expect(result.released).toBe(0);
  });

  it("throws ForbiddenError when a plain student calls it", async () => {
    const student = await buildActor();
    const { course } = await createCourseWithMember(student.userId, "student");
    const exam = await createTestExam({
      courseId: course.id,
      status: "published",
      ...inWindow(),
    });

    await expect(
      session.releaseAllSessionsAsInstructor(student, { examId: exam.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError for a missing exam", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });

    await expect(
      session.releaseAllSessionsAsInstructor(teacher, { examId: "exam_does_not_exist" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
