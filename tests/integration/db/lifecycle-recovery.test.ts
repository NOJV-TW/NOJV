import { describe, expect, it } from "vitest";

import { assessmentRepo, contestRepo, examRepo } from "@nojv/db";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  testPrisma,
} from "../../fixtures/factories";

describe("lifecycle recovery queries", () => {
  it("recovers expired exams and contests but skips expired notification-only assignments", async () => {
    const now = new Date();
    const pastStart = new Date(now.getTime() - 2 * 60 * 60_000);
    const pastEnd = new Date(now.getTime() - 60 * 60_000);
    const futureStart = new Date(now.getTime() + 60 * 60_000);
    const futureEnd = new Date(now.getTime() + 2 * 60 * 60_000);
    const course = await createTestCourse();

    const [
      pastExam,
      futureExam,
      draftExam,
      pastContest,
      futureContest,
      draftContest,
      finalizedContest,
    ] = await Promise.all([
      createTestExam({ courseId: course.id, startsAt: pastStart, endsAt: pastEnd }),
      createTestExam({ courseId: course.id, startsAt: futureStart, endsAt: futureEnd }),
      createTestExam({
        courseId: course.id,
        startsAt: pastStart,
        endsAt: pastEnd,
        status: "draft",
      }),
      createTestContest({ startsAt: pastStart, endsAt: pastEnd }),
      createTestContest({ startsAt: futureStart, endsAt: futureEnd }),
      createTestContest({
        startsAt: pastStart,
        endsAt: pastEnd,
        visibility: "draft",
      }),
      createTestContest({
        startsAt: pastStart,
        endsAt: pastEnd,
        frozenBoard: false,
      }),
    ]);

    const [pastAssignment, futureAssignment, draftAssignment] = await Promise.all([
      testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: course.ownerId,
          title: "Past assignment",
          summary: "Past",
          status: "published",
          opensAt: pastStart,
          closesAt: pastEnd,
        },
      }),
      testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: course.ownerId,
          title: "Future assignment",
          summary: "Future",
          status: "published",
          opensAt: futureStart,
          closesAt: futureEnd,
        },
      }),
      testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: course.ownerId,
          title: "Draft assignment",
          summary: "Draft",
          status: "draft",
          opensAt: futureStart,
          closesAt: futureEnd,
        },
      }),
    ]);

    await testPrisma.activeExamSession.create({
      data: { examId: pastExam.id, userId: course.ownerId },
    });

    const [exams, contests, assignments] = await Promise.all([
      examRepo.listNeedingTimers({ now, take: 100 }),
      contestRepo.listNeedingTimers({ now, take: 100 }),
      assessmentRepo.listNeedingTimers({ now, take: 100 }),
    ]);
    const examIds = exams.map(({ id }) => id);
    const contestIds = contests.map(({ id }) => id);
    const assignmentIds = assignments.map(({ id }) => id);

    expect(examIds).toEqual(expect.arrayContaining([pastExam.id, futureExam.id]));
    expect(examIds).not.toContain(draftExam.id);
    expect(contestIds).toEqual(expect.arrayContaining([pastContest.id, futureContest.id]));
    expect(contestIds).not.toContain(draftContest.id);
    expect(contestIds).not.toContain(finalizedContest.id);
    expect(assignmentIds).toContain(futureAssignment.id);
    expect(assignmentIds).not.toContain(pastAssignment.id);
    expect(assignmentIds).not.toContain(draftAssignment.id);
  });
});
