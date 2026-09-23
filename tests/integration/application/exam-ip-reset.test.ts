import { describe, expect, it } from "vitest";

import { examDomain, proctoringDomain } from "@nojv/application";
import type { ActorContext } from "../../../packages/application/src/shared/actor-context";
import {
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

function actorOf(
  user: { id: string; username: string | null; name: string; email: string },
  platformRole: ActorContext["platformRole"],
) {
  const actor: ActorContext = {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole,
  };
  return actor;
}

async function classroom(examOverrides: Record<string, unknown>) {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const student = await createTestUser();
  const course = await createTestCourse({ ownerId: teacher.id });
  await testPrisma.courseMembership.createMany({
    data: [
      { courseId: course.id, userId: teacher.id, role: "teacher" },
      { courseId: course.id, userId: student.id, role: "student" },
    ],
  });
  const exam = await createTestExam({
    courseId: course.id,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3_600_000),
    ...examOverrides,
  });
  return { teacher: actorOf(teacher, "teacher"), student: actorOf(student, "student"), exam };
}

function gate(examId: string, userId: string, ip: string) {
  return proctoringDomain.checkProctoringGate({
    entityKind: "exam",
    entityId: examId,
    userId,
    ip,
  });
}

describe("resetStudentIpBinding — live gate", () => {
  it("lets a re-pinned student back in from a new IP without an active session", async () => {
    const { teacher, student, exam } = await classroom({
      ipBindingEnabled: true,
      ipViolationMode: "block",
    });
    await examDomain.session.startSession(student, { examId: exam.id });

    expect(await gate(exam.id, student.userId, "203.0.113.10")).toEqual({ ok: true });
    expect(await gate(exam.id, student.userId, "198.51.100.20")).toEqual({
      ok: false,
      reason: "ip_binding",
    });

    await examDomain.session.releaseSessionAsInstructor(teacher, {
      examId: exam.id,
      targetUserId: student.userId,
    });
    expect(await gate(exam.id, student.userId, "198.51.100.20")).toEqual({
      ok: false,
      reason: "ip_binding",
    });

    await examDomain.session.resetStudentIpBinding(teacher, {
      examId: exam.id,
      targetUserId: student.userId,
    });

    expect(await gate(exam.id, student.userId, "198.51.100.20")).toEqual({ ok: true });

    const participation = await testPrisma.participation.findUniqueOrThrow({
      where: { type_examId_userId: { type: "exam", examId: exam.id, userId: student.userId } },
    });
    expect(participation.ipPin).toBe("198.51.100.20");

    const events = await testPrisma.examSessionEvent.findMany({
      where: { session: { examId: exam.id, userId: student.userId }, eventType: "ip_reset" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ clearedIpPin: "203.0.113.10" });
  });

  it("exempts a whitelist-blocked student who never entered the exam", async () => {
    const { teacher, student, exam } = await classroom({
      ipWhitelistEnabled: true,
      ipWhitelist: ["203.0.113.0/24"],
      ipViolationMode: "block",
    });

    expect(await gate(exam.id, student.userId, "198.51.100.20")).toEqual({
      ok: false,
      reason: "ip_whitelist",
    });

    await examDomain.session.resetStudentIpBinding(teacher, {
      examId: exam.id,
      targetUserId: student.userId,
    });

    expect(await gate(exam.id, student.userId, "198.51.100.20")).toEqual({ ok: true });
  });
});
