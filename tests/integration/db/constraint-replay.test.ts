import { describe, expect, it } from "vitest";

import {
  createTestContest,
  createTestCourse,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

describe("replayed CHECK constraints are enforced in the test DB", () => {
  it("has the participation CHECK constraints (parity with migrations)", async () => {
    const rows = await testPrisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'Participation_%'`,
    );
    const names = rows.map((r) => r.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        "Participation_single_context_chk",
        "Participation_virtual_window_chk",
        "Participation_ip_exam_only_chk",
      ]),
    );
  });

  it("rejects a virtual participation missing its start/end window", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    await expect(
      testPrisma.participation.create({
        data: {
          type: "virtual",
          userId: user.id,
          contestId: contest.id,
          status: "active",
        },
      }),
    ).rejects.toThrow(/Participation_virtual_window_chk|check constraint/i);
  });

  it("rejects a virtual participation whose end is not after its start", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    await expect(
      testPrisma.participation.create({
        data: {
          type: "virtual",
          userId: user.id,
          contestId: contest.id,
          status: "active",
          startedAt: new Date("2026-01-01T02:00:00Z"),
          endsAt: new Date("2026-01-01T02:00:00Z"),
        },
      }),
    ).rejects.toThrow(/Participation_virtual_window_chk|check constraint/i);
  });

  it("rejects IP-proctoring columns on a non-exam participation", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    await expect(
      testPrisma.participation.create({
        data: {
          type: "contest",
          userId: user.id,
          contestId: contest.id,
          status: "active",
          startedAt: new Date(),
          ipPin: "203.0.113.7",
        },
      }),
    ).rejects.toThrow(/Participation_ip_exam_only_chk|check constraint/i);
  });

  it("accepts a well-formed virtual participation", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    const row = await testPrisma.participation.create({
      data: {
        type: "virtual",
        userId: user.id,
        contestId: contest.id,
        status: "active",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-01-01T02:00:00Z"),
      },
    });
    expect(row.id).toBeTruthy();
  });

  it("has validated effective-window CHECK constraints", async () => {
    const rows = await testPrisma.$queryRawUnsafe<
      { conname: string; convalidated: boolean }[]
    >(`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conname IN (
        'Exam_effective_time_window_chk',
        'Contest_effective_time_window_chk',
        'Assessment_effective_time_window_chk'
      )
      ORDER BY conname
    `);

    expect(rows).toEqual([
      { conname: "Assessment_effective_time_window_chk", convalidated: true },
      { conname: "Contest_effective_time_window_chk", convalidated: true },
      { conname: "Exam_effective_time_window_chk", convalidated: true },
    ]);
  });

  it("has a validated virtual participation window constraint", async () => {
    const rows = await testPrisma.$queryRawUnsafe<
      { conname: string; convalidated: boolean }[]
    >(`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conname = 'Participation_virtual_window_chk'
    `);

    expect(rows).toEqual([{ conname: "Participation_virtual_window_chk", convalidated: true }]);
  });

  it("rejects invalid Exam, Contest, and Assessment windows directly", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const start = new Date("2030-01-02T00:00:00.000Z");
    const end = new Date("2030-01-01T00:00:00.000Z");

    await expect(
      testPrisma.exam.create({
        data: {
          courseId: course.id,
          title: "Invalid exam",
          summary: "Invalid exam window",
          startsAt: start,
          endsAt: end,
        },
      }),
    ).rejects.toThrow(/Exam_effective_time_window_chk|check constraint/i);

    await expect(
      testPrisma.contest.create({
        data: {
          title: "Invalid contest",
          summary: "Invalid contest window",
          startsAt: start,
          endsAt: end,
        },
      }),
    ).rejects.toThrow(/Contest_effective_time_window_chk|check constraint/i);

    await expect(
      testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Invalid assessment",
          summary: "Invalid assessment due date",
          opensAt: new Date("2030-01-01T00:00:00.000Z"),
          dueAt: new Date("2030-01-03T00:00:00.000Z"),
          closesAt: new Date("2030-01-02T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(/Assessment_effective_time_window_chk|check constraint/i);
  });
});
