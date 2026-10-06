import { describe, expect, it } from "vitest";

import { problemDomain } from "@nojv/application";
import { createTestProblem, createTestUser, testPrisma } from "../../fixtures/factories";

async function draftProblemWith(judgeConfig: Record<string, unknown>) {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const problem = await createTestProblem({
    authorId: teacher.id,
    status: "draft",
    visibility: "private",
    judgeConfig,
    samples: [{ input: "1 100\ncorrect", output: "50" }],
  });
  const actor = {
    userId: teacher.id,
    username: teacher.username,
    platformRole: teacher.platformRole,
  };
  return { actor, problem };
}

const interactive = { type: "interactive", interactorLanguage: "python" };

describe("interactor input on problem samples", () => {
  it("rejects interactive samples without a non-blank interactor input", async () => {
    const { actor, problem } = await draftProblemWith(interactive);

    for (const samples of [
      [{ input: "1 100\ncorrect", output: "50" }],
      [
        { input: "1 100\ncorrect", output: "50", interactorInput: "50\n" },
        { input: "1 100\ncorrect", output: "50", interactorInput: " \n" },
      ],
    ]) {
      await expect(
        problemDomain.updateProblemRecord(actor, problem.id, { samples }),
      ).rejects.toMatchObject({
        name: "ValidationError",
        message: "Every interactive sample needs an interactor input.",
      });
    }
    await expect(
      testPrisma.problem.findUniqueOrThrow({ where: { id: problem.id } }),
    ).resolves.toMatchObject({ samples: [{ input: "1 100\ncorrect", output: "50" }] });
  });

  it("saves interactive samples that carry an interactor input", async () => {
    const { actor, problem } = await draftProblemWith(interactive);
    const samples = [
      { input: "1 100\nlower\ncorrect", output: "50\n42", interactorInput: "42\n" },
    ];

    await problemDomain.updateProblemRecord(actor, problem.id, { samples });

    const detail = await problemDomain.getProblemPageData(problem.id);
    expect(detail.samples).toEqual(samples);
  });

  it("does not require an interactor input on checker problems", async () => {
    const { actor, problem } = await draftProblemWith({
      type: "checker",
      checkerLanguage: "python",
    });
    const samples = [{ input: "4 9\n2 7 4 5\n", output: "1 2" }];

    await problemDomain.updateProblemRecord(actor, problem.id, { samples });

    const detail = await problemDomain.getProblemPageData(problem.id);
    expect(detail.samples).toEqual(samples);
  });

  it("checks samples against a judge type changed in the same update", async () => {
    const { actor, problem } = await draftProblemWith(interactive);
    const samples = [{ input: "1 2", output: "3" }];

    await problemDomain.updateProblemRecord(actor, problem.id, {
      judgeConfig: { type: "standard" },
      samples,
    });

    await expect(
      testPrisma.problem.findUniqueOrThrow({ where: { id: problem.id } }),
    ).resolves.toMatchObject({ judgeConfig: { type: "standard" }, samples });
  });

  it("lets an existing problem switch to interactive without an interactor input", async () => {
    const { actor, problem } = await draftProblemWith({ type: "standard" });

    await problemDomain.saveProblemJudgeConfig(actor, problem.id, {
      judgeConfig: { type: "interactive" },
    });

    await expect(
      testPrisma.problem.findUniqueOrThrow({ where: { id: problem.id } }),
    ).resolves.toMatchObject({
      judgeConfig: { type: "interactive" },
      samples: [{ input: "1 100\ncorrect", output: "50" }],
    });
  });
});
