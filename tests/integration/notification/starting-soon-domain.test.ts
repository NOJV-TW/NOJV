import { beforeEach, describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { notificationDomain } from "@nojv/application";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

beforeEach(async () => {
  await testPrisma.$executeRawUnsafe('TRUNCATE TABLE "Notification" CASCADE');
});

describe("notificationDomain.fanoutExamStartingSoon", () => {
  it("notifies every registered participant of a published, not-yet-started exam", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });

    const startsAt = new Date(Date.now() + 60 * 60_000);
    const exam = await createTestExam({
      courseId: course.id,
      createdByUserId: teacher.id,
      title: "Midterm",
      status: "published",
      startsAt,
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });

    const studentA = await createTestUser({ platformRole: "student" });
    const studentB = await createTestUser({ platformRole: "student" });
    for (const s of [studentA, studentB]) {
      await testPrisma.participation.create({
        data: { type: "exam", examId: exam.id, userId: s.id, status: "registered" },
      });
    }
    const studentC = await createTestUser({ platformRole: "student" });

    await notificationDomain.fanoutExamStartingSoon(exam.id, 1);

    const rowsA = await notificationRepo.listRecent(studentA.id, 10);
    const rowsB = await notificationRepo.listRecent(studentB.id, 10);
    const rowsC = await notificationRepo.listRecent(studentC.id, 10);

    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsC).toHaveLength(0);

    const row = rowsA[0]!;
    expect(row.type).toBe("exam_starting_soon");
    expect(row.linkUrl).toBe(`/exams/${exam.id}`);
    const params = row.params as {
      courseId: string;
      examId: string;
      title: string;
      startsAt: string;
    };
    expect(params.courseId).toBe(course.id);
    expect(params.examId).toBe(exam.id);
    expect(params.title).toBe("Midterm");
    expect(params.startsAt).toBe(startsAt.toISOString());
  });

  it("is idempotent — a re-run (activity retry) does not duplicate notifications", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const exam = await createTestExam({
      courseId: course.id,
      createdByUserId: teacher.id,
      status: "published",
      startsAt: new Date(Date.now() + 60 * 60_000),
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });
    const student = await createTestUser({ platformRole: "student" });
    await testPrisma.participation.create({
      data: { type: "exam", examId: exam.id, userId: student.id, status: "registered" },
    });

    await notificationDomain.fanoutExamStartingSoon(exam.id, 1);
    await notificationDomain.fanoutExamStartingSoon(exam.id, 1);

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(1);
  });

  it("is a no-op when the exam has already started", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const student = await createTestUser({ platformRole: "student" });

    const exam = await createTestExam({
      courseId: course.id,
      createdByUserId: teacher.id,
      status: "published",
      startsAt: new Date(Date.now() - 60 * 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });
    await testPrisma.participation.create({
      data: { type: "exam", examId: exam.id, userId: student.id, status: "active" },
    });

    await notificationDomain.fanoutExamStartingSoon(exam.id, 1);

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("is a no-op when the exam is still a draft", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const student = await createTestUser({ platformRole: "student" });

    const exam = await createTestExam({
      courseId: course.id,
      createdByUserId: teacher.id,
      status: "draft",
      startsAt: new Date(Date.now() + 60 * 60_000),
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });
    await testPrisma.participation.create({
      data: { type: "exam", examId: exam.id, userId: student.id, status: "registered" },
    });

    await notificationDomain.fanoutExamStartingSoon(exam.id, 1);

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("is a no-op when the exam has no participants", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const student = await createTestUser({ platformRole: "student" });

    const exam = await createTestExam({
      courseId: course.id,
      createdByUserId: teacher.id,
      status: "published",
      startsAt: new Date(Date.now() + 60 * 60_000),
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });

    await notificationDomain.fanoutExamStartingSoon(exam.id, 1);

    const rows = await notificationRepo.listRecent(student.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("targets only participants whose lead-day preference matches the checkpoint", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const exam = await createTestExam({
      courseId: course.id,
      createdByUserId: teacher.id,
      status: "published",
      startsAt: new Date(Date.now() + 3 * 24 * 60 * 60_000),
      endsAt: new Date(Date.now() + 4 * 24 * 60 * 60_000),
    });

    const wantsTwo = await createTestUser({ platformRole: "student" });
    const wantsDefault = await createTestUser({ platformRole: "student" });
    for (const s of [wantsTwo, wantsDefault]) {
      await testPrisma.participation.create({
        data: { type: "exam", examId: exam.id, userId: s.id, status: "registered" },
      });
    }
    await testPrisma.notificationPreference.create({
      data: { userId: wantsTwo.id, examStartingLeadDays: 2 },
    });

    await notificationDomain.fanoutExamStartingSoon(exam.id, 1);
    expect(await notificationRepo.listRecent(wantsTwo.id, 10)).toHaveLength(0);
    expect(await notificationRepo.listRecent(wantsDefault.id, 10)).toHaveLength(1);

    await notificationDomain.fanoutExamStartingSoon(exam.id, 2);
    expect(await notificationRepo.listRecent(wantsTwo.id, 10)).toHaveLength(1);
  });
});

describe("notificationDomain.fanoutContestStartingSoon", () => {
  it("notifies every registered participant of a published, not-yet-started contest", async () => {
    const startsAt = new Date(Date.now() + 60 * 60_000);
    const contest = await createTestContest({
      title: "Winter Open",
      visibility: "published",
      startsAt,
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });

    const userA = await createTestUser();
    const userB = await createTestUser();
    for (const u of [userA, userB]) {
      await testPrisma.participation.create({
        data: { type: "contest", contestId: contest.id, userId: u.id, status: "registered" },
      });
    }
    const userC = await createTestUser();

    await notificationDomain.fanoutContestStartingSoon(contest.id, 1);

    const rowsA = await notificationRepo.listRecent(userA.id, 10);
    const rowsB = await notificationRepo.listRecent(userB.id, 10);
    const rowsC = await notificationRepo.listRecent(userC.id, 10);

    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsC).toHaveLength(0);

    const row = rowsA[0]!;
    expect(row.type).toBe("contest_starting_soon");
    expect(row.linkUrl).toBe(`/contests/${contest.id}`);
    const params = row.params as {
      contestId: string;
      title: string;
      startsAt: string;
    };
    expect(params.contestId).toBe(contest.id);
    expect(params.title).toBe("Winter Open");
    expect(params.startsAt).toBe(startsAt.toISOString());
  });

  it("is idempotent — a re-run (activity retry) does not duplicate notifications", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date(Date.now() + 60 * 60_000),
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });
    const user = await createTestUser();
    await testPrisma.participation.create({
      data: { type: "contest", contestId: contest.id, userId: user.id, status: "registered" },
    });

    await notificationDomain.fanoutContestStartingSoon(contest.id, 1);
    await notificationDomain.fanoutContestStartingSoon(contest.id, 1);

    const rows = await notificationRepo.listRecent(user.id, 10);
    expect(rows).toHaveLength(1);
  });

  it("is a no-op when the contest has already started", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date(Date.now() - 60 * 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });
    const user = await createTestUser();
    await testPrisma.participation.create({
      data: { type: "contest", contestId: contest.id, userId: user.id, status: "active" },
    });

    await notificationDomain.fanoutContestStartingSoon(contest.id, 1);

    const rows = await notificationRepo.listRecent(user.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("is a no-op when the contest is still a draft", async () => {
    const contest = await createTestContest({
      visibility: "draft",
      startsAt: new Date(Date.now() + 60 * 60_000),
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });
    const user = await createTestUser();
    await testPrisma.participation.create({
      data: { type: "contest", contestId: contest.id, userId: user.id, status: "registered" },
    });

    await notificationDomain.fanoutContestStartingSoon(contest.id, 1);

    const rows = await notificationRepo.listRecent(user.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("is a no-op when the contest has no participants", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date(Date.now() + 60 * 60_000),
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });
    const user = await createTestUser();

    await notificationDomain.fanoutContestStartingSoon(contest.id, 1);

    const rows = await notificationRepo.listRecent(user.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("targets only participants whose lead-day preference matches the checkpoint", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date(Date.now() + 3 * 24 * 60 * 60_000),
      endsAt: new Date(Date.now() + 4 * 24 * 60 * 60_000),
    });

    const wantsTwo = await createTestUser();
    const wantsDefault = await createTestUser();
    for (const u of [wantsTwo, wantsDefault]) {
      await testPrisma.participation.create({
        data: { type: "contest", contestId: contest.id, userId: u.id, status: "registered" },
      });
    }
    await testPrisma.notificationPreference.create({
      data: { userId: wantsTwo.id, contestStartingLeadDays: 2 },
    });

    await notificationDomain.fanoutContestStartingSoon(contest.id, 1);
    expect(await notificationRepo.listRecent(wantsTwo.id, 10)).toHaveLength(0);
    expect(await notificationRepo.listRecent(wantsDefault.id, 10)).toHaveLength(1);

    await notificationDomain.fanoutContestStartingSoon(contest.id, 2);
    expect(await notificationRepo.listRecent(wantsTwo.id, 10)).toHaveLength(1);
  });
});
