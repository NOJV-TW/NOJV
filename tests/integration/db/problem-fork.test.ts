import { describe, expect, it } from "vitest";

import {
  assignmentDomain,
  configureDomainOrchestration,
  contestDomain,
  courseDomain,
  examDomain,
  problemDomain,
} from "@nojv/application";
import { runTransaction } from "@nojv/db";
import { storagePointerFor } from "@nojv/storage";

import {
  createTestCourse,
  createTestProblem,
  createTestProblemWorkspaceFile,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

function actorOf(user: {
  email: string;
  id: string;
  name: string;
  username: string;
  platformRole: "student" | "teacher" | "admin";
}) {
  return {
    displayName: user.name,
    email: user.email,
    userId: user.id,
    username: user.username,
    platformRole: user.platformRole,
  };
}

async function addAcceptedReference(problemId: string, userId: string, generation: number) {
  const reference = await createTestSubmission({
    isReferenceSolution: true,
    problemId,
    referenceProblemStorageGeneration: generation,
    sampleOnly: false,
    status: "accepted",
    userId,
  });
  await testPrisma.problem.update({
    where: { id: problemId },
    data: { referenceSolutionSubmissionId: reference.id },
  });
  return reference;
}

describe("problem forks", () => {
  it("deep-copies judge content and the current Accepted reference snapshot only", async () => {
    const sourceAuthor = await createTestUser({ platformRole: "teacher" });
    const forkAuthor = await createTestUser({ platformRole: "teacher" });
    const source = await createTestProblem({
      authorId: sourceAuthor.id,
      adminMayPublish: true,
      difficulty: "hard",
      judgeConfig: { type: "standard", compare: { mode: "tokens" } },
      storageGeneration: 4,
      tags: ["dp", "graph"],
    });
    const checkerStorage = storagePointerFor("problems/shared/checker", Buffer.from("checker"));
    const interactorStorage = storagePointerFor(
      "problems/shared/interactor",
      Buffer.from("interactor"),
    );
    const inputFile = storagePointerFor("problems/shared/input-file", Buffer.from("fixture"));
    await testPrisma.problem.update({
      where: { id: source.id },
      data: { checkerStorage, interactorStorage },
    });
    const sourceCase = await testPrisma.testcase.findFirstOrThrow({
      where: { testcaseSet: { problemId: source.id } },
    });
    await testPrisma.testcase.update({
      where: { id: sourceCase.id },
      data: { inputFileStorage: { fixture: inputFile } },
    });
    await createTestProblemWorkspaceFile({
      problemId: source.id,
      content: "int main() {}",
      description: "starter",
    });
    const reference = await addAcceptedReference(source.id, sourceAuthor.id, 4);
    await createTestSubmission({ problemId: source.id, userId: sourceAuthor.id });
    await testPrisma.problemBookmark.create({
      data: { problemId: source.id, userId: sourceAuthor.id },
    });

    const fork = await problemDomain.forkProblemRecord(actorOf(forkAuthor), source.id);
    const copied = await testPrisma.problem.findUniqueOrThrow({
      where: { id: fork.id },
      include: {
        _count: {
          select: {
            assessmentLinks: true,
            bookmarks: true,
            contestLinks: true,
            examLinks: true,
            posts: true,
            submissions: true,
          },
        },
        referenceSolutionSubmission: true,
        statement: true,
        testcaseSets: { include: { testcases: true } },
        workspaceFiles: true,
      },
    });

    expect(copied).toMatchObject({
      adminMayPublish: false,
      authorId: forkAuthor.id,
      difficulty: "hard",
      displayId: null,
      forkedFromProblemId: source.id,
      status: "draft",
      storageGeneration: 4,
      tags: ["dp", "graph"],
      title: source.title,
      visibility: "private",
    });
    expect(copied.statement).toMatchObject({
      bodyMarkdown: "Test problem body",
      inputFormat: "Test input format",
      outputFormat: "Test output format",
    });
    expect(copied.checkerStorage).toEqual(checkerStorage);
    expect(copied.interactorStorage).toEqual(interactorStorage);
    expect(copied.workspaceFiles).toHaveLength(1);
    expect(copied.workspaceFiles[0]?.contentStorage).toEqual(
      (
        await testPrisma.problemWorkspaceFile.findFirstOrThrow({
          where: { problemId: source.id },
        })
      ).contentStorage,
    );
    expect(copied.testcaseSets).toHaveLength(1);
    expect(copied.testcaseSets[0]?.testcases[0]).toMatchObject({
      inputFileStorage: { fixture: inputFile },
      inputStorage: sourceCase.inputStorage,
      outputStorage: sourceCase.outputStorage,
    });
    expect(copied.referenceSolutionSubmission).toMatchObject({
      isReferenceSolution: true,
      language: reference.language,
      problemId: copied.id,
      referenceProblemStorageGeneration: 4,
      sourceStorage: reference.sourceStorage,
      status: "accepted",
      userId: forkAuthor.id,
      verdictDetailStorage: reference.verdictDetailStorage,
    });
    expect(copied._count).toEqual({
      assessmentLinks: 0,
      bookmarks: 0,
      contestLinks: 0,
      examLinks: 0,
      posts: 0,
      submissions: 1,
    });

    await problemDomain.updateProblemRecord(actorOf(forkAuthor), copied.id, {
      timeLimitMs: copied.timeLimitMs + 1,
    });
    const invalidated = await testPrisma.problem.findUniqueOrThrow({
      where: { id: copied.id },
    });
    expect(invalidated.referenceSolutionSubmissionId).toBeNull();
    expect(invalidated.storageGeneration).toBe(5);
    expect(
      await testPrisma.problem.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      referenceSolutionSubmissionId: reference.id,
      storageGeneration: 4,
    });
  });

  it("allows an active TA but rejects students and non-public sources", async () => {
    const source = await createTestProblem();
    const student = await createTestUser();
    const ta = await createTestUser();
    const owner = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: owner.id });
    await testPrisma.courseMembership.create({
      data: {
        addedByUserId: owner.id,
        courseId: course.id,
        role: "ta",
        status: "active",
        userId: ta.id,
      },
    });

    await expect(problemDomain.forkProblemRecord(actorOf(student), source.id)).rejects.toThrow(
      "Only teachers, admins, and active course TAs",
    );
    await expect(
      problemDomain.forkProblemRecord(actorOf(ta), source.id),
    ).resolves.toMatchObject({
      authorId: ta.id,
    });

    const privateProblem = await createTestProblem({ status: "draft", visibility: "private" });
    await expect(
      problemDomain.forkProblemRecord(actorOf(ta), privateProblem.id),
    ).rejects.toThrow("Only published public problems");
  });

  it("rechecks source visibility from the row-locked snapshot", async () => {
    const source = await createTestProblem();
    const teacher = await createTestUser({ platformRole: "teacher" });
    await testPrisma.problem.update({
      where: { id: source.id },
      data: { status: "draft", visibility: "private" },
    });

    await expect(
      runTransaction((tx) =>
        problemDomain.forkProblemInTransaction(tx, source.id, {
          authorId: teacher.id,
          published: false,
          requirePublishedPublicSource: true,
        }),
      ),
    ).rejects.toThrow("Only published public problems");
    expect(await testPrisma.problem.count({ where: { forkedFromProblemId: source.id } })).toBe(
      0,
    );
  });

  it("uses owned problems directly, forks public foreign problems, and rolls back failures", async () => {
    const actor = await createTestUser({ platformRole: "teacher" });
    const own = await createTestProblem({
      authorId: actor.id,
      status: "draft",
      visibility: "private",
    });
    const foreign = await createTestProblem();
    const foreignPrivate = await createTestProblem({
      status: "draft",
      visibility: "private",
    });

    const candidateIds = new Set(
      (await problemDomain.listActivityCandidateProblems(actor.id)).map(
        (problem) => problem.id,
      ),
    );
    expect(candidateIds.has(own.id)).toBe(true);
    expect(candidateIds.has(foreign.id)).toBe(true);
    expect(candidateIds.has(foreignPrivate.id)).toBe(false);

    const resolved = await runTransaction((tx) =>
      problemDomain.resolveActivityProblems(tx, actorOf(actor), [own.id, foreign.id]),
    );
    expect(resolved[0]?.id).toBe(own.id);
    expect(resolved[1]).toMatchObject({
      authorId: actor.id,
      forkedFromProblemId: foreign.id,
      status: "draft",
      visibility: "private",
    });

    const before = await testPrisma.problem.count({
      where: { forkedFromProblemId: foreign.id },
    });
    await expect(
      runTransaction(async (tx) => {
        await problemDomain.resolveActivityProblems(tx, actorOf(actor), [foreign.id]);
        throw new Error("activity failed");
      }),
    ).rejects.toThrow("activity failed");
    expect(await testPrisma.problem.count({ where: { forkedFromProblemId: foreign.id } })).toBe(
      before,
    );
  });

  it("creates independent activity forks and reuses an already owned fork on update", async () => {
    configureDomainOrchestration({
      ensureContestLifecycle: async () => undefined,
    } as never);
    const teacher = await createTestUser({ platformRole: "teacher" });
    const source = await createTestProblem();
    const course = await createTestCourse({ ownerId: teacher.id });
    await testPrisma.courseMembership.create({
      data: {
        addedByUserId: teacher.id,
        courseId: course.id,
        role: "teacher",
        status: "active",
        userId: teacher.id,
      },
    });
    const startsAt = "2030-01-01T00:00:00.000Z";
    const dueAt = "2030-01-02T00:00:00.000Z";
    const endsAt = "2030-01-03T00:00:00.000Z";

    const assignment = await courseDomain.createCourseAssignmentRecord(
      actorOf(teacher),
      course.id,
      {
        allowedLanguages: [],
        closesAt: endsAt,
        courseId: course.id,
        dueAt,
        latePenalty: null,
        opensAt: startsAt,
        problemIds: [source.id],
        status: "draft",
        title: "Forked assignment",
      },
    );
    const assignmentLink = await testPrisma.assessmentProblem.findFirstOrThrow({
      where: { assessmentId: assignment.id },
    });
    await assignmentDomain.updateAssignmentRecord(actorOf(teacher), assignment.id, {
      problemIds: [assignmentLink.problemId],
    });

    const exam = await examDomain.createExamRecord(actorOf(teacher), {
      allowedLanguages: [],
      courseId: course.id,
      endsAt,
      ipBindingEnabled: false,
      ipViolationMode: "notify",
      ipWhitelist: [],
      ipWhitelistEnabled: false,
      pageLockEnabled: false,
      problemIds: [source.id],
      scoreboardMode: "hidden",
      scoringMode: "point_sum",
      startsAt,
      status: "draft",
      submitCooldownSec: 0,
      summary: "Exam summary",
      title: "Forked exam",
    });
    const examLink = await testPrisma.examProblem.findFirstOrThrow({
      where: { examId: exam.id },
    });
    await examDomain.updateExamRecord(actorOf(teacher), exam.id, {
      problemIds: [examLink.problemId],
    });

    const contest = await contestDomain.createContestRecord(actorOf(teacher), {
      allowedLanguages: [],
      endsAt,
      id: `fork-contest-${Date.now().toString(36)}`,
      penaltyMinutesPerWrong: 20,
      problems: [{ problemId: source.id, points: 100 }],
      scoreboardMode: "live",
      scoringMode: "problem_count",
      startsAt,
      submitCooldownSec: 0,
      summary: "Contest fork coverage",
      title: "Forked contest",
    });
    const contestLink = await testPrisma.contestProblem.findFirstOrThrow({
      where: { contestId: contest.id },
    });
    await contestDomain.updateContestRecord(actorOf(teacher), contest.id, {
      problems: [{ problemId: contestLink.problemId, points: 100 }],
    });

    const linkedIds = [
      (
        await testPrisma.assessmentProblem.findFirstOrThrow({
          where: { assessmentId: assignment.id },
        })
      ).problemId,
      (await testPrisma.examProblem.findFirstOrThrow({ where: { examId: exam.id } })).problemId,
      (
        await testPrisma.contestProblem.findFirstOrThrow({
          where: { contestId: contest.id },
        })
      ).problemId,
    ];
    expect(new Set(linkedIds).size).toBe(3);
    expect(
      await testPrisma.problem.count({
        where: { authorId: teacher.id, forkedFromProblemId: source.id },
      }),
    ).toBe(3);
  });

  it("publishes an Admin-owned fork and leaves the authorized private source unchanged", async () => {
    const author = await createTestUser({ platformRole: "teacher" });
    const admin = await createTestUser({ platformRole: "admin" });
    const source = await createTestProblem({
      adminMayPublish: false,
      authorId: author.id,
      status: "draft",
      visibility: "private",
    });
    await addAcceptedReference(source.id, author.id, source.storageGeneration);
    await problemDomain.updateProblemRecord(actorOf(author), source.id, {
      adminMayPublish: true,
    });

    const result = await problemDomain.publishProblemAsAdmin(actorOf(admin), source.id);
    expect(result.id).not.toBe(source.id);
    await expect(
      testPrisma.problem.findUniqueOrThrow({ where: { id: result.id } }),
    ).resolves.toMatchObject({
      authorId: admin.id,
      displayId: expect.any(Number),
      forkedFromProblemId: source.id,
      status: "published",
      visibility: "public",
    });
    await expect(
      testPrisma.problem.findUniqueOrThrow({ where: { id: source.id } }),
    ).resolves.toMatchObject({
      adminMayPublish: false,
      authorId: author.id,
      displayId: null,
      status: "draft",
      visibility: "private",
    });
  });

  it("rejects Admin publication without consent or a valid reference solution", async () => {
    const author = await createTestUser({ platformRole: "teacher" });
    const admin = await createTestUser({ platformRole: "admin" });
    const source = await createTestProblem({
      adminMayPublish: false,
      authorId: author.id,
      status: "draft",
      visibility: "private",
    });

    await expect(
      problemDomain.publishProblemAsAdmin(actorOf(admin), source.id),
    ).rejects.toThrow("The author has not allowed an admin to publish this problem.");
    await problemDomain.updateProblemRecord(actorOf(author), source.id, {
      adminMayPublish: true,
    });
    await expect(
      problemDomain.publishProblemAsAdmin(actorOf(admin), source.id),
    ).rejects.toThrow("Problems require an accepted reference solution before publishing.");
  });
});
