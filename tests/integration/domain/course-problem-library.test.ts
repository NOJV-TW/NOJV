import { describe, expect, it } from "vitest";
import {
  courseDomain,
  problemDomain,
  submissionDomain,
  userDomain,
  type ActorContext,
} from "@nojv/application";
import {
  createTestCourse,
  createTestProblem,
  createTestProblemWorkspaceFile,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

function actorOf(user: Awaited<ReturnType<typeof createTestUser>>): ActorContext {
  if (!user.username) throw new Error("Actor fixture requires a username.");
  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    displayName: user.name,
    platformRole: user.platformRole,
  };
}

describe("course problem library lifecycle (real DB)", () => {
  it("attaches an owned public multi-file fork and copies its unpublished private draft", async () => {
    const owner = actorOf(await createTestUser({ platformRole: "teacher" }));
    const course = await createTestCourse({ ownerId: owner.userId });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: owner.userId, role: "teacher" },
    });
    const source = await createTestProblem({
      authorId: owner.userId,
      type: "multi_file",
      visibility: "public",
      status: "published",
    });
    const workspace = await createTestProblemWorkspaceFile({
      problemId: source.id,
      language: "cpp",
      path: "main.cpp",
      visibility: "editable",
    });
    const assignment = await courseDomain.createCourseAssignmentRecord(owner, course.id, {
      courseId: course.id,
      title: "Owned public multi file",
      opensAt: "2030-01-01T00:00:00Z",
      dueAt: "2030-01-02T00:00:00Z",
      closesAt: "2030-01-02T00:00:00Z",
      allowLateSubmissions: false,
      latePenalty: null,
      allowedLanguages: ["cpp"],
      totalPoints: 100,
      problems: [{ problemId: source.id, points: 100 }],
      status: "draft",
    });
    const link = await testPrisma.assessmentProblem.findFirstOrThrow({
      where: { assessmentId: assignment.id },
    });
    expect(link.problemId).not.toBe(source.id);
    expect(
      await testPrisma.problem.findUnique({ where: { id: link.problemId } }),
    ).toMatchObject({ authorId: owner.userId, visibility: "private", status: "draft" });
    expect(
      await testPrisma.problemWorkspaceFile.findMany({ where: { problemId: link.problemId } }),
    ).toEqual([
      expect.objectContaining({ contentStorage: workspace.contentStorage, path: "main.cpp" }),
    ]);
    const copied = await courseDomain.copyCourse(
      owner,
      course.id,
      "Copy with unpublished fork",
    );
    expect(
      await testPrisma.assessmentProblem.findMany({
        where: { assessment: { courseId: copied.newCourseId } },
      }),
    ).toEqual([expect.objectContaining({ problemId: link.problemId })]);
    expect(
      await testPrisma.courseProblem.count({
        where: { courseId: copied.newCourseId, problemId: link.problemId },
      }),
    ).toBe(1);
  });

  it("transfers ownership while the recipient holds a course-owner foreign key lock", async () => {
    const owner = actorOf(await createTestUser());
    const recipient = actorOf(await createTestUser());
    const problem = await createTestProblem({ authorId: owner.userId });
    let ready!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const courseCreation = testPrisma.$transaction(async (tx) => {
      await tx.course.create({
        data: { ownerId: recipient.userId, title: "Concurrent course", description: "" },
      });
      ready();
      await released;
      await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problem.id} FOR UPDATE`;
    });
    await Promise.race([locked, courseCreation]);
    let transferred = false;
    const transfer = problemDomain
      .transferProblemOwnership(owner, problem.id, recipient.username)
      .then((result) => {
        transferred = true;
        return result;
      });
    void transfer.catch(() => undefined);
    try {
      await expect.poll(() => transferred, { timeout: 2_000 }).toBe(true);
    } finally {
      release();
      await Promise.allSettled([courseCreation, transfer]);
    }
    await expect(courseCreation).resolves.toBeUndefined();
    await expect(transfer).resolves.toEqual({ id: problem.id, authorId: recipient.userId });
  });

  it("supports TA editing and reference validation while preserving ownership, publication copies, and submission boundaries", async () => {
    const owner = actorOf(await createTestUser({ platformRole: "teacher" }));
    const ta = actorOf(await createTestUser());
    const course = await createTestCourse({ ownerId: owner.userId });
    const otherCourse = await createTestCourse({ ownerId: ta.userId });
    await testPrisma.courseMembership.createMany({
      data: [
        { courseId: course.id, userId: owner.userId, role: "teacher" },
        { courseId: course.id, userId: ta.userId, role: "ta" },
        { courseId: otherCourse.id, userId: ta.userId, role: "teacher" },
      ],
    });
    const problem = await createTestProblem({
      authorId: owner.userId,
      visibility: "private",
      status: "draft",
    });
    await courseDomain.addCourseProblems(owner, course.id, [problem.id]);
    await problemDomain.updateProblemRecord(ta, problem.id, {
      title: "TA prepared problem",
      statement: "Shared statement",
    });
    const reference = await submissionDomain.createQueuedSubmissionRecord(
      {
        context: { type: "practice" },
        problemId: problem.id,
        language: "cpp",
        sourceCode: "int main() {}",
        referenceSolution: true,
      },
      ta,
      "127.0.0.1",
    );
    await submissionDomain.startSubmissionJudgeRun(reference.id, "library-reference-run");
    await submissionDomain.completeJudge(reference.id, "library-reference-run", {
      accepted: true,
      verdict: "accepted",
      score: 100,
      feedback: "Accepted",
      runtimeMs: 1,
      memoryKb: 1,
    });
    expect(await submissionDomain.getProblemReferenceSolution(owner, problem.id)).toMatchObject(
      {
        status: "verified",
        submissionId: reference.id,
        sourceFiles: [{ content: "int main() {}" }],
      },
    );
    expect(await submissionDomain.getSubmissionDetail(owner, reference.id)).toMatchObject({
      id: reference.id,
      viewerIsStaff: true,
    });
    const ordinary = await createTestSubmission({
      userId: owner.userId,
      problemId: problem.id,
    });
    await expect(submissionDomain.getSubmissionDetail(ta, ordinary.id)).rejects.toThrow(
      /not found/i,
    );
    await problemDomain.updateProblemRecord(ta, problem.id, { status: "published" });
    const privateBefore = await testPrisma.problem.findUniqueOrThrow({
      where: { id: problem.id },
    });
    expect(privateBefore).toMatchObject({
      authorId: owner.userId,
      visibility: "private",
      status: "published",
      referenceSolutionSubmissionId: reference.id,
    });
    await expect(
      problemDomain.updateProblemRecord(ta, problem.id, { adminMayPublish: true }),
    ).rejects.toThrow(/Only the problem author/);
    await expect(
      problemDomain.updateProblemRecord(ta, problem.id, { visibility: "public" }),
    ).rejects.toThrow(/author or an admin/);
    for (const actor of [ta, { ...ta, platformRole: "admin" as const }]) {
      await expect(
        courseDomain.addCourseProblems(actor, otherCourse.id, [problem.id]),
      ).rejects.toThrow(/owner/);
    }

    const published = await problemDomain.updateProblemRecord(owner, problem.id, {
      visibility: "public",
      status: "published",
    });
    expect(published.id).not.toBe(problem.id);
    expect(await testPrisma.problem.findUnique({ where: { id: problem.id } })).toEqual(
      privateBefore,
    );
    const publicCopy = await testPrisma.problem.findUniqueOrThrow({
      where: { id: published.id },
      include: { statement: true },
    });
    expect(publicCopy).toMatchObject({
      authorId: owner.userId,
      visibility: "public",
      status: "published",
      forkedFromProblemId: problem.id,
      statement: { bodyMarkdown: "Shared statement" },
    });
    await problemDomain.updateProblemRecord(ta, problem.id, {
      statement: "Next private revision",
    });
    expect(
      await testPrisma.problemStatement.findUnique({ where: { problemId: published.id } }),
    ).toEqual(publicCopy.statement);

    expect(
      await courseDomain.addCourseProblems(ta, course.id, [problem.id, problem.id]),
    ).toEqual({ problemIds: [problem.id] });
    const assignment = await courseDomain.createCourseAssignmentRecord(ta, course.id, {
      courseId: course.id,
      title: "Shared activity",
      opensAt: "2030-01-01T00:00:00Z",
      dueAt: "2030-01-02T00:00:00Z",
      closesAt: "2030-01-02T00:00:00Z",
      allowLateSubmissions: false,
      latePenalty: null,
      allowedLanguages: [],
      totalPoints: 100,
      problems: [{ problemId: problem.id, points: 100 }],
      status: "draft",
    });
    expect(
      await testPrisma.assessmentProblem.findMany({ where: { assessmentId: assignment.id } }),
    ).toEqual([expect.objectContaining({ problemId: problem.id })]);
    await expect(courseDomain.removeCourseProblem(ta, course.id, problem.id)).rejects.toThrow(
      /activity or history/,
    );
    await expect(problemDomain.deleteProblemRecord(owner, problem.id)).rejects.toThrow(/draft/);
    await problemDomain.transferProblemOwnership(owner, problem.id, ta.username);
    await expect(userDomain.deleteUser(false, ta.userId)).rejects.toThrow(/Transfer ownership/);
    expect(await testPrisma.user.findUnique({ where: { id: ta.userId } })).toMatchObject({
      disabled: false,
      username: ta.username,
    });
    expect(
      await testPrisma.courseProblem.findMany({ where: { problemId: problem.id } }),
    ).toEqual([expect.objectContaining({ courseId: course.id, addedByUserId: owner.userId })]);
  });
});
