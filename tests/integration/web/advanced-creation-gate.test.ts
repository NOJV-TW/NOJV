import { describe, expect, it } from "vitest";

import type { AdvancedConfig, ProblemCreate } from "@nojv/core";
import { ConflictError, ForbiddenError, problemDomain } from "@nojv/application";

import {
  createTestProblem,
  createTestProblemWorkspaceFile,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

import type { ProblemActorContext } from "../../../packages/application/src/problem/permissions";

function actorOf(user: {
  id: string;
  username: string;
  platformRole: ProblemActorContext["platformRole"];
}): ProblemActorContext {
  return {
    userId: user.id,
    username: user.username,
    platformRole: user.platformRole,
  };
}

const DIGEST = `sha256:${"a".repeat(64)}`;

function advancedConfig(): AdvancedConfig {
  return {
    run: { imageRef: `ghcr.io/nojv-tw/run@${DIGEST}`, imageSource: "registry" },
    grade: { imageRef: `ghcr.io/nojv-tw/grade@${DIGEST}`, imageSource: "registry" },
    network: { mode: "none" },
    maxScore: 100,
  };
}

const basePayload: Omit<ProblemCreate, "type" | "advancedConfig"> = {
  difficulty: "medium",
  inputFormat: "",
  memoryLimitMb: 256,
  outputFormat: "",
  statement: "",
  status: "draft",
  tags: [],
  timeLimitMs: 1000,
  title: "Advanced Gate Test",
  visibility: "private",
};

describe("canCreateAdvancedProblems gate", () => {
  it("rejects special_env creation for a teacher without the flag", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    await expect(
      problemDomain.createProblemRecord(actorOf(teacher), {
        ...basePayload,
        type: "special_env",
        advancedConfig: advancedConfig(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows special_env creation for a teacher with the flag", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const result = await problemDomain.createProblemRecord(actorOf(teacher), {
      ...basePayload,
      type: "special_env",
      advancedConfig: advancedConfig(),
    });
    const row = await testPrisma.problem.findUnique({ where: { id: result.id } });
    expect(row?.type).toBe("special_env");
  });

  it("allows special_env creation for an admin without the flag", async () => {
    const admin = await createTestUser({ platformRole: "admin" });
    await expect(
      problemDomain.createProblemRecord(actorOf(admin), {
        ...basePayload,
        type: "special_env",
        advancedConfig: advancedConfig(),
      }),
    ).resolves.toBeDefined();
  });

  it("rejects convertProblemToAdvancedMode without the flag", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id, status: "draft" });
    await expect(
      problemDomain.convertProblemToAdvancedMode(actorOf(teacher), problem.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a type flip to special_env through updateProblemRecord without the flag", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id, status: "draft" });
    await expect(
      problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
        type: "special_env",
        advancedConfig: advancedConfig(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects converting a published problem before deleting its judge data", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createTestProblem({
      authorId: teacher.id,
      status: "published",
      type: "multi_file",
    });
    await createTestProblemWorkspaceFile({ problemId: problem.id });

    await expect(
      problemDomain.convertProblemToAdvancedMode(actorOf(teacher), problem.id),
    ).rejects.toBeInstanceOf(ConflictError);

    const [stored, testcaseSetCount, workspaceFileCount] = await Promise.all([
      testPrisma.problem.findUnique({ where: { id: problem.id } }),
      testPrisma.testcaseSet.count({ where: { problemId: problem.id } }),
      testPrisma.problemWorkspaceFile.count({ where: { problemId: problem.id } }),
    ]);
    expect(stored).toMatchObject({ status: "published", type: "multi_file" });
    expect(testcaseSetCount).toBe(1);
    expect(workspaceFileCount).toBe(1);
  });

  it("rejects converting and publishing a standard draft in one generic mutation", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createTestProblem({ authorId: teacher.id, status: "draft" });

    await expect(
      problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
        status: "published",
        type: "special_env",
        advancedConfig: advancedConfig(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const stored = await testPrisma.problem.findUnique({ where: { id: problem.id } });
    expect(stored).toMatchObject({ status: "draft", type: "full_source" });
  });

  it("rejects changing the type of an already-published standard problem", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createTestProblem({ authorId: teacher.id, status: "published" });

    await expect(
      problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
        type: "special_env",
        advancedConfig: advancedConfig(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const stored = await testPrisma.problem.findUnique({ where: { id: problem.id } });
    expect(stored).toMatchObject({ status: "published", type: "full_source" });
  });
});

describe("special_env publish gate — accepted test run required", () => {
  async function createDraftAdvancedProblem(authorId: string) {
    return createTestProblem({
      authorId,
      status: "draft",
      type: "special_env",
      advancedConfig: advancedConfig(),
    });
  }

  it("blocks publishing without any accepted run", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createDraftAdvancedProblem(teacher.id);

    await expect(
      problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
        status: "published",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks publishing when the accepted run used different images", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createDraftAdvancedProblem(teacher.id);

    await createTestSubmission({
      problemId: problem.id,
      userId: teacher.id,
      language: "python",
      status: "accepted",
      advancedConfigSnapshot: {
        config: {
          ...advancedConfig(),
          run: { imageRef: `ghcr.io/nojv-tw/old@${DIGEST}`, imageSource: "registry" },
        },
        requiredPaths: [],
        resourceLimits: { totalTimeMs: 1_000, memoryMb: 256 },
      },
    });

    await expect(
      problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
        status: "published",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("publishes once an accepted run matches the current images", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createDraftAdvancedProblem(teacher.id);

    await createTestSubmission({
      problemId: problem.id,
      userId: teacher.id,
      language: "python",
      status: "accepted",
      sampleOnly: true,
      advancedConfigSnapshot: {
        config: advancedConfig(),
        requiredPaths: [],
        resourceLimits: { totalTimeMs: 1_000, memoryMb: 256 },
      },
    });

    await problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
      status: "published",
    });
    const row = await testPrisma.problem.findUnique({ where: { id: problem.id } });
    expect(row?.status).toBe("published");
  });

  it("validates the post-update title when title and publish are submitted together", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createDraftAdvancedProblem(teacher.id);
    await createTestSubmission({
      problemId: problem.id,
      userId: teacher.id,
      language: "python",
      status: "accepted",
      sampleOnly: true,
      advancedConfigSnapshot: {
        config: advancedConfig(),
        requiredPaths: [],
        resourceLimits: { totalTimeMs: 1_000, memoryMb: 256 },
      },
    });

    await expect(
      problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
        title: "",
        status: "published",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks publishing when resource limits changed after the accepted run", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createDraftAdvancedProblem(teacher.id);

    await createTestSubmission({
      problemId: problem.id,
      userId: teacher.id,
      language: "python",
      status: "accepted",
      sampleOnly: true,
      advancedConfigSnapshot: {
        config: advancedConfig(),
        requiredPaths: [],
        resourceLimits: { totalTimeMs: 1_000, memoryMb: 256 },
      },
    });

    await problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
      timeLimitMs: 2_000,
    });
    await expect(
      problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
        status: "published",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks publishing when required paths changed after the accepted run", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createDraftAdvancedProblem(teacher.id);
    await createTestSubmission({
      problemId: problem.id,
      userId: teacher.id,
      language: "python",
      status: "accepted",
      advancedConfigSnapshot: {
        config: advancedConfig(),
        requiredPaths: [],
        resourceLimits: { totalTimeMs: 1_000, memoryMb: 256 },
      },
    });
    await problemDomain.updateAdvancedJudgeConfiguration(actorOf(teacher), problem.id, {
      config: advancedConfig(),
      requiredPaths: ["main.py"],
    });

    await expect(
      problemDomain.updateProblemRecord(actorOf(teacher), problem.id, { status: "published" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("re-reads the locked row before publishing after a concurrent config update", async () => {
    const teacher = await createTestUser({
      platformRole: "teacher",
      canCreateAdvancedProblems: true,
    });
    const problem = await createDraftAdvancedProblem(teacher.id);
    await createTestSubmission({
      problemId: problem.id,
      userId: teacher.id,
      language: "python",
      status: "accepted",
      advancedConfigSnapshot: {
        config: advancedConfig(),
        requiredPaths: [],
        resourceLimits: { totalTimeMs: 1_000, memoryMb: 256 },
      },
    });

    let releaseLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let rowLocked!: () => void;
    const rowIsLocked = new Promise<void>((resolve) => {
      rowLocked = resolve;
    });
    const concurrentUpdate = testPrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problem.id} FOR UPDATE`;
      rowLocked();
      await lockHeld;
      await tx.problem.update({
        where: { id: problem.id },
        data: { advancedConfig: { ...advancedConfig(), maxScore: 200 } },
      });
    });
    await rowIsLocked;
    const publish = problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
      status: "published",
    });
    releaseLock();
    await concurrentUpdate;

    await expect(publish).rejects.toBeInstanceOf(ConflictError);
    const row = await testPrisma.problem.findUnique({ where: { id: problem.id } });
    expect(row).toMatchObject({ status: "draft" });
  });
});
