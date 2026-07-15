import { describe, expect, it } from "vitest";

import { examSessionRepo } from "@nojv/db";

import {
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

describe("examSessionRepo (real DB)", () => {
  it("round-trips: start → record events → end → list events in order", async () => {
    const user = await createTestUser();
    const course = await createTestCourse();
    const exam = await createTestExam({ courseId: course.id });

    const started = await examSessionRepo.startSession({
      userId: user.id,
      examId: exam.id,
    });
    expect(started.endedAt).toBeNull();

    await examSessionRepo.recordEvent({
      sessionId: started.id,
      eventType: "enter",
    });
    await examSessionRepo.recordEvent({
      sessionId: started.id,
      eventType: "visibility_lost",
      metadata: { durationMs: 1200 },
    });
    await examSessionRepo.recordEvent({
      sessionId: started.id,
      eventType: "heartbeat",
    });

    const ended = await examSessionRepo.endSession({
      sessionId: started.id,
      reason: "submitted",
    });
    expect(ended.endedAt).not.toBeNull();
    expect(ended.releaseReason).toBe("submitted");

    await examSessionRepo.recordEvent({
      sessionId: started.id,
      eventType: "release",
      metadata: { reason: "submitted" },
    });

    const events = await examSessionRepo.listEventsForSession(started.id);
    expect(events.map((e) => e.eventType)).toEqual([
      "enter",
      "visibility_lost",
      "heartbeat",
      "release",
    ]);
    expect(events[1]!.metadata).toEqual({ durationMs: 1200 });
    expect(events[3]!.metadata).toEqual({ reason: "submitted" });
  });

  it("findActiveForUser returns the unended session and null after end", async () => {
    const user = await createTestUser();
    const course = await createTestCourse();
    const exam = await createTestExam({ courseId: course.id });

    expect(await examSessionRepo.findActiveForUser(user.id)).toBeNull();

    const started = await examSessionRepo.startSession({
      userId: user.id,
      examId: exam.id,
    });

    const active = await examSessionRepo.findActiveForUser(user.id);
    expect(active?.id).toBe(started.id);

    await examSessionRepo.endSession({
      sessionId: started.id,
      reason: "time_up",
    });

    expect(await examSessionRepo.findActiveForUser(user.id)).toBeNull();
  });

  it("startSession is idempotent against the (userId, examId) unique and returns the same row", async () => {
    const user = await createTestUser();
    const course = await createTestCourse();
    const exam = await createTestExam({ courseId: course.id });

    const first = await examSessionRepo.startSession({
      userId: user.id,
      examId: exam.id,
    });
    const second = await examSessionRepo.startSession({
      userId: user.id,
      examId: exam.id,
    });

    expect(second.id).toBe(first.id);

    const rows = await testPrisma.activeExamSession.findMany({
      where: { userId: user.id, examId: exam.id },
    });
    expect(rows).toHaveLength(1);
  });

  it("enforces one active exam session per user across different exams", async () => {
    const user = await createTestUser();
    const course = await createTestCourse();
    const firstExam = await createTestExam({ courseId: course.id });
    const secondExam = await createTestExam({ courseId: course.id });

    const first = await testPrisma.activeExamSession.create({
      data: { userId: user.id, examId: firstExam.id },
    });

    await expect(
      testPrisma.activeExamSession.create({
        data: { userId: user.id, examId: secondExam.id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await testPrisma.activeExamSession.update({
      where: { id: first.id },
      data: { endedAt: new Date(), releaseReason: "submitted" },
    });

    await expect(
      testPrisma.activeExamSession.create({
        data: { userId: user.id, examId: secondExam.id },
      }),
    ).resolves.toMatchObject({ userId: user.id, examId: secondExam.id, endedAt: null });
  });

  it("updateHeartbeat touches lastHeartbeatAt but not endedAt", async () => {
    const user = await createTestUser();
    const course = await createTestCourse();
    const exam = await createTestExam({ courseId: course.id });

    const started = await examSessionRepo.startSession({
      userId: user.id,
      examId: exam.id,
    });
    const firstBeat = started.lastHeartbeatAt;

    await new Promise((r) => setTimeout(r, 5));
    const updated = await examSessionRepo.updateHeartbeat(started.id);

    expect(updated.lastHeartbeatAt.getTime()).toBeGreaterThanOrEqual(firstBeat.getTime());
    expect(updated.endedAt).toBeNull();
  });

  it("cascade-deletes sessions and events when the parent exam is removed", async () => {
    const user = await createTestUser();
    const course = await createTestCourse();
    const exam = await createTestExam({ courseId: course.id });

    const started = await examSessionRepo.startSession({
      userId: user.id,
      examId: exam.id,
    });
    await examSessionRepo.recordEvent({ sessionId: started.id, eventType: "enter" });
    await examSessionRepo.recordEvent({ sessionId: started.id, eventType: "heartbeat" });

    expect(await testPrisma.activeExamSession.count({ where: { examId: exam.id } })).toBe(1);
    expect(await testPrisma.examSessionEvent.count({ where: { sessionId: started.id } })).toBe(
      2,
    );

    await testPrisma.exam.delete({ where: { id: exam.id } });

    expect(await testPrisma.activeExamSession.count({ where: { examId: exam.id } })).toBe(0);
    expect(await testPrisma.examSessionEvent.count({ where: { sessionId: started.id } })).toBe(
      0,
    );
  });
});
