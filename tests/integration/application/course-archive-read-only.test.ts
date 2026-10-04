import { afterEach, describe, expect, it, vi } from "vitest";

import {
  announcementDomain,
  clarificationDomain,
  courseDomain,
  examDomain,
  feedbackDomain,
  plagiarismDomain,
  scoreOverrideDomain,
  submissionDomain,
} from "@nojv/application";
import type { ActorContext } from "../../../packages/application/src/shared/actor-context";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const readOnly = { name: "ValidationError", message: "Archived courses are read-only." };

afterEach(() => vi.unstubAllEnvs());

function actorOf(
  user: { id: string; username: string | null; name: string; email: string },
  platformRole: ActorContext["platformRole"],
): ActorContext {
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole,
  };
}

async function archivedCourse() {
  const teacherUser = await createTestUser({ platformRole: "teacher" });
  const studentUser = await createTestUser();
  const course = await createTestCourse({ ownerId: teacherUser.id });
  await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: teacherUser.id, role: "teacher" },
  });
  const membership = await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: studentUser.id, role: "student" },
  });
  const problem = await createTestProblem({ authorId: teacherUser.id });
  const assignment = await testPrisma.assessment.create({
    data: {
      courseId: course.id,
      createdByUserId: teacherUser.id,
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
    examPasswordEnabled: true,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3_600_000),
  });
  await testPrisma.examProblem.create({
    data: { examId: exam.id, problemId: problem.id, ordinal: 1, points: 100 },
  });
  await testPrisma.participation.create({
    data: { type: "exam", examId: exam.id, userId: studentUser.id, status: "active" },
  });
  const submission = await createTestSubmission({
    assessmentId: assignment.id,
    courseId: course.id,
    problemId: problem.id,
    userId: studentUser.id,
    status: "accepted",
    score: 100,
  });
  const clarification = await testPrisma.clarification.create({
    data: {
      contextType: "exam",
      contextId: exam.id,
      askedByUserId: studentUser.id,
      questionText: "Is the input sorted?",
    },
  });
  const announcement = await announcementDomain.createAnnouncement({
    title: "Week 1",
    content: "Welcome",
    published: true,
    courseId: course.id,
    createdByUserId: teacherUser.id,
  });
  const teacher = actorOf(teacherUser, "teacher");
  await courseDomain.setCourseArchived(teacher, course.id, true);
  return {
    teacher,
    student: actorOf(studentUser, "student"),
    course,
    membership,
    problem,
    assignment,
    exam,
    submission,
    clarification,
    announcement,
  };
}

describe("archived course writes (real DB)", () => {
  it("rejects course info, announcement and roster writes", async () => {
    const f = await archivedCourse();
    const writes = [
      () =>
        courseDomain.updateCourse(f.teacher, f.course.id, {
          title: "Renamed",
          description: "",
        }),
      () =>
        announcementDomain.createAnnouncement({
          title: "Week 2",
          content: "Again",
          published: true,
          courseId: f.course.id,
        }),
      () =>
        announcementDomain.updateAnnouncement(f.announcement.id, {
          title: "Edited",
          content: "Edited",
          published: true,
        }),
      () => announcementDomain.toggleAnnouncementPin(f.announcement.id),
      () => announcementDomain.deleteAnnouncement(f.announcement.id),
      () =>
        courseDomain.bulkAddByHandle(f.teacher, f.course.id, {
          handles: ["newcomer"],
          role: "student",
        }),
      () => courseDomain.changeMemberRole(f.teacher, f.course.id, f.membership.id, "ta"),
      () => courseDomain.removeMember(f.teacher, f.course.id, f.membership.id),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject(readOnly);

    const course = await testPrisma.course.findUniqueOrThrow({ where: { id: f.course.id } });
    expect(course.title).toBe(f.course.title);
    expect(await testPrisma.announcement.count({ where: { courseId: f.course.id } })).toBe(1);
    expect(
      await testPrisma.courseMembership.findUniqueOrThrow({ where: { id: f.membership.id } }),
    ).toMatchObject({ role: "student", status: "active" });
    expect(await testPrisma.courseMembership.count({ where: { courseId: f.course.id } })).toBe(
      2,
    );
  });

  it("rejects grading, rejudge, clarification and plagiarism writes", async () => {
    vi.stubEnv("SANDBOX_IMAGE", `sandbox@sha256:${"a".repeat(64)}`);
    const f = await archivedCourse();
    const context = { type: "assignment", assignmentId: f.assignment.id } as const;
    const writes = [
      () =>
        scoreOverrideDomain.createOverride(f.teacher, {
          context,
          courseMembershipId: f.membership.id,
          problemId: f.problem.id,
          overrideScore: 90,
          reason: "Manual grade",
        }),
      () =>
        feedbackDomain.upsertFeedback(f.teacher, {
          context,
          input: {
            courseMembershipId: f.membership.id,
            problemId: f.problem.id,
            comment: "Check edge cases",
          },
        }),
      () =>
        submissionDomain.dispatchRejudge(
          {
            mode: "single",
            submissionId: f.submission.id,
            triggeredByUserId: f.teacher.userId,
          },
          f.teacher,
        ),
      () =>
        clarificationDomain.ask(f.student, {
          context: { type: "exam", examId: f.exam.id },
          questionText: "Can we use recursion here?",
        }),
      () =>
        clarificationDomain.answer(f.teacher, f.clarification.id, {
          answerText: "Yes.",
          isPublic: true,
        }),
      () => clarificationDomain.dismiss(f.teacher, f.clarification.id),
      () => clarificationDomain.deleteClarification(f.student, f.clarification.id),
      () =>
        plagiarismDomain.createPlagiarismReport(
          { type: "assessment", id: f.assignment.id },
          f.teacher.userId,
        ),
      () =>
        plagiarismDomain.flagPair(f.teacher, {
          contextType: "assessment",
          contextId: f.assignment.id,
          pairKey: plagiarismDomain.buildPairKey(
            f.student.userId,
            f.teacher.userId,
            f.problem.id,
          ),
        }),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject(readOnly);

    expect(
      await testPrisma.scoreOverride.count({ where: { assessmentId: f.assignment.id } }),
    ).toBe(0);
    expect(
      await testPrisma.submissionFeedback.count({ where: { assessmentId: f.assignment.id } }),
    ).toBe(0);
    expect(
      await testPrisma.judgeExecution.count({ where: { submissionId: f.submission.id } }),
    ).toBe(0);
    expect(
      await testPrisma.clarification.findMany({ where: { contextId: f.exam.id } }),
    ).toEqual([
      expect.objectContaining({ id: f.clarification.id, state: "pending", deletedAt: null }),
    ]);
    expect(
      await testPrisma.plagiarismTriggerLog.count({ where: { contextId: f.assignment.id } }),
    ).toBe(0);
    expect(
      await testPrisma.plagiarismPairFlag.count({ where: { contextId: f.assignment.id } }),
    ).toBe(0);
  });

  it("rejects exam staff actions", async () => {
    const f = await archivedCourse();
    const target = { examId: f.exam.id, targetUserId: f.student.userId };
    const writes = [
      () => examDomain.session.releaseAllSessionsAsInstructor(f.teacher, { examId: f.exam.id }),
      () => examDomain.session.releaseSessionAsInstructor(f.teacher, target),
      () => examDomain.session.resetStudentIpBinding(f.teacher, target),
      () =>
        examDomain.credentials.setPassword(
          f.teacher,
          f.exam.id,
          f.student.userId,
          "SyntheticExamPassword24",
        ),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject(readOnly);
    expect(await testPrisma.activeExamSession.count({ where: { examId: f.exam.id } })).toBe(0);
    expect(await testPrisma.examCredential.count({ where: { examId: f.exam.id } })).toBe(0);
  });

  it("still lets staff copy and unarchive the course, then write again", async () => {
    const f = await archivedCourse();
    const { newCourseId } = await courseDomain.copyCourse(f.teacher, f.course.id, "Next term");
    expect(
      await testPrisma.course.findUniqueOrThrow({ where: { id: newCourseId } }),
    ).toMatchObject({ archived: false });

    await courseDomain.setCourseArchived(f.teacher, f.course.id, false);
    await courseDomain.updateCourse(f.teacher, f.course.id, {
      title: "Renamed",
      description: "",
    });
    expect(
      await testPrisma.course.findUniqueOrThrow({ where: { id: f.course.id } }),
    ).toMatchObject({ archived: false, title: "Renamed" });
  });
});
