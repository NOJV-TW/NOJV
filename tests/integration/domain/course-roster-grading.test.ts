import { describe, expect, it } from "vitest";

import {
  courseDomain,
  examDomain,
  feedbackDomain,
  scoreOverrideDomain,
} from "@nojv/application";
import { scoreOverrideRepo } from "@nojv/db";
import type { ActorContext } from "../../../packages/application/src/shared/actor-context";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function gradingFixture() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const course = await createTestCourse({ ownerId: teacher.id });
  await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: teacher.id, role: "teacher" },
  });
  const membership = await testPrisma.courseMembership.create({
    data: { courseId: course.id, pendingUsername: "ntu_b12345678", role: "student" },
  });
  const problem = await createTestProblem({ authorId: teacher.id });
  await testPrisma.testcaseSet.updateMany({
    where: { problemId: problem.id },
    data: { weight: 100 },
  });
  const assignment = await testPrisma.assessment.create({
    data: {
      courseId: course.id,
      createdByUserId: teacher.id,
      title: "Closed HW",
      summary: "",
      status: "published",
      opensAt: new Date("2020-01-01"),
      closesAt: new Date("2020-01-02"),
      problems: { create: { problemId: problem.id, ordinal: 1, points: 100 } },
    },
  });
  const exam = await createTestExam({
    courseId: course.id,
    scoringMode: "point_sum",
    startsAt: new Date("2020-01-01"),
    endsAt: new Date("2020-01-02"),
  });
  await testPrisma.examProblem.create({
    data: { examId: exam.id, problemId: problem.id, ordinal: 1, points: 100 },
  });
  const actor: ActorContext = {
    userId: teacher.id,
    username: teacher.username ?? teacher.id,
    email: teacher.email,
    displayName: teacher.name,
    platformRole: "teacher",
  };
  const contexts = [
    { type: "assignment", assignmentId: assignment.id } as const,
    { type: "exam", examId: exam.id } as const,
  ];
  return { actor, course, membership, problem, assignment, exam, contexts };
}

describe("course roster grading contract (real DB)", () => {
  it("grades pending assignment and exam rows, then resolves reads through the linked account", async () => {
    const { actor, course, membership, problem, assignment, exam, contexts } =
      await gradingFixture();
    for (const context of contexts) {
      await scoreOverrideDomain.createOverride(actor, {
        context,
        courseMembershipId: membership.id,
        problemId: problem.id,
        overrideScore: 90,
        reason: "Manual grade",
      });
      await feedbackDomain.upsertFeedback(actor, {
        context,
        input: {
          courseMembershipId: membership.id,
          problemId: problem.id,
          comment: "Review boundary cases",
        },
      });
    }
    expect(await testPrisma.participation.count({ where: { examId: exam.id } })).toBe(0);
    expect(await testPrisma.submission.count({ where: { problemId: problem.id } })).toBe(0);
    expect(await testPrisma.durableWork.count({ where: { kind: "score.converge" } })).toBe(0);
    const scores = await testPrisma.scoreOverride.findMany({
      where: { courseMembershipId: membership.id },
    });
    expect(scores).toHaveLength(2);
    expect(scores.every((row) => row.userId === null)).toBe(true);
    const audits = await testPrisma.scoreOverrideAuditLog.findMany({
      where: { courseMembershipId: membership.id },
    });
    expect(audits).toHaveLength(2);
    expect(
      audits.every((row) => row.userId === null && row.sourceMembershipId === membership.id),
    ).toBe(true);
    expect((await courseDomain.buildCourseGradebook(course.id)).rows[0]).toMatchObject({
      membershipId: membership.id,
      userId: null,
      total: 180,
    });

    const feedbackBefore = await testPrisma.submissionFeedback.findMany({
      where: { courseMembershipId: membership.id },
    });
    await courseDomain.correctPendingUsername(
      actor,
      course.id,
      membership.id,
      " NTU_B12345679 ",
    );
    expect(
      await testPrisma.courseMembership.findUnique({ where: { id: membership.id } }),
    ).toEqual({ ...membership, pendingUsername: "ntu_b12345679", updatedAt: expect.any(Date) });
    const student = await createTestUser({ username: "ntu_b12345679" });
    await courseDomain.correctPendingUsername(
      actor,
      course.id,
      membership.id,
      student.username!,
    );
    expect(
      await testPrisma.scoreOverride.findMany({ where: { courseMembershipId: membership.id } }),
    ).toEqual(scores);
    expect(
      await testPrisma.scoreOverrideAuditLog.findMany({
        where: { courseMembershipId: membership.id },
      }),
    ).toEqual(audits);
    expect(
      await testPrisma.submissionFeedback.findMany({
        where: { courseMembershipId: membership.id },
      }),
    ).toEqual(feedbackBefore);
    const stranger = await createTestUser();
    for (const context of contexts) {
      expect(await feedbackDomain.getFeedbackForStudent(stranger.id, context)).toEqual([]);
      expect(await feedbackDomain.getFeedbackForStudent(membership.id, context)).toEqual([]);
      expect(await feedbackDomain.getFeedbackForStudent(student.id, context)).toHaveLength(1);
    }
    expect(
      (await courseDomain.buildCourseGradebook(course.id, { forUserId: student.id })).rows[0],
    ).toMatchObject({ membershipId: membership.id, userId: student.id, total: 180 });
    const assignmentPage = await courseDomain.getAssignmentDetail(course.id, assignment.id, {
      viewerUserId: student.id,
      isManager: false,
    });
    expect(assignmentPage.problems[0]?.myStatus).toMatchObject({
      bestScore: 90,
      attempts: 0,
      overridden: true,
    });
    expect(
      (
        await examDomain.getExamDetailPage(exam.id, {
          viewerUserId: student.id,
          isManager: false,
        })
      )?.viewerScore,
    ).toBe(90);
    expect(await scoreOverrideRepo.findForExamUser(exam.id, stranger.id)).toEqual([]);
    expect(await scoreOverrideRepo.findForExamUser(exam.id, student.id)).toEqual([
      { userId: student.id, problemId: problem.id, overrideScore: 90 },
    ]);

    await examDomain.updateExamScores(exam.id, student.id);
    expect(await testPrisma.participation.count({ where: { examId: exam.id } })).toBe(0);
    const participation = await testPrisma.participation.create({
      data: { type: "exam", examId: exam.id, userId: student.id, status: "submitted" },
    });
    await examDomain.updateExamScores(exam.id, student.id);
    expect(
      Number(
        (await testPrisma.participation.findUniqueOrThrow({ where: { id: participation.id } }))
          .score,
      ),
    ).toBe(90);
  });

  it.each(["wrong_course", "removed", "ta"] as const)(
    "rejects %s membership targets for scores and feedback",
    async (invalid) => {
      const { actor, membership, problem, contexts } = await gradingFixture();
      if (invalid === "wrong_course") {
        const other = await createTestCourse();
        await testPrisma.courseMembership.update({
          where: { id: membership.id },
          data: { courseId: other.id },
        });
      } else {
        await testPrisma.courseMembership.update({
          where: { id: membership.id },
          data: invalid === "removed" ? { status: "removed" } : { role: "ta" },
        });
      }
      for (const context of contexts) {
        await expect(
          scoreOverrideDomain.createOverride(actor, {
            context,
            courseMembershipId: membership.id,
            problemId: problem.id,
            overrideScore: 90,
            reason: "invalid target",
          }),
        ).rejects.toThrow(/actively enrolled/);
        await expect(
          feedbackDomain.upsertFeedback(actor, {
            context,
            input: {
              courseMembershipId: membership.id,
              problemId: problem.id,
              comment: "invalid target",
            },
          }),
        ).rejects.toThrow(/actively enrolled/);
      }
      expect(
        await testPrisma.scoreOverride.count({ where: { courseMembershipId: membership.id } }),
      ).toBe(0);
      expect(
        await testPrisma.submissionFeedback.count({
          where: { courseMembershipId: membership.id },
        }),
      ).toBe(0);
    },
  );

  it("rejects feedback for a problem outside its assignment or exam", async () => {
    const { actor, membership, contexts } = await gradingFixture();
    const unrelated = await createTestProblem({ authorId: actor.userId });
    for (const context of contexts) {
      await expect(
        feedbackDomain.upsertFeedback(actor, {
          context,
          input: {
            courseMembershipId: membership.id,
            problemId: unrelated.id,
            comment: "wrong problem",
          },
        }),
      ).rejects.toThrow(/not part of this context/);
    }
  });
});
