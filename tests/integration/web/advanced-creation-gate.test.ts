import { describe, expect, it } from "vitest";

import type { AdvancedConfig, ProblemCreate } from "@nojv/core";
import { ConflictError, ForbiddenError, problemDomain } from "@nojv/application";

import { createTestProblem, createTestUser, testPrisma } from "../../fixtures/factories";

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

    await testPrisma.submission.create({
      data: {
        problemId: problem.id,
        userId: teacher.id,
        language: "python",
        sourceStoragePrefix: "test/none",
        status: "accepted",
        advancedConfigSnapshot: {
          ...advancedConfig(),
          run: { imageRef: `ghcr.io/nojv-tw/old@${DIGEST}`, imageSource: "registry" },
        },
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

    await testPrisma.submission.create({
      data: {
        problemId: problem.id,
        userId: teacher.id,
        language: "python",
        sourceStoragePrefix: "test/none",
        status: "accepted",
        sampleOnly: true,
        advancedConfigSnapshot: advancedConfig(),
      },
    });

    await problemDomain.updateProblemRecord(actorOf(teacher), problem.id, {
      status: "published",
    });
    const row = await testPrisma.problem.findUnique({ where: { id: problem.id } });
    expect(row?.status).toBe("published");
  });
});
