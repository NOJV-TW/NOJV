import { describe, expect, it } from "vitest";

import { problemDomain } from "@nojv/application";
import { createTestProblem, createTestUser } from "../../fixtures/factories";

async function teacherActor() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  return {
    userId: teacher.id,
    username: teacher.username,
    platformRole: teacher.platformRole,
  };
}

describe("interaction notes on problem statements", () => {
  it("stores the notes given when a problem is created", async () => {
    const actor = await teacherActor();

    const problem = await problemDomain.createProblemRecord(actor, {
      adminMayPublish: false,
      difficulty: "medium",
      inputFormat: "",
      interactionFormat: "Print `? x` to ask, `! x` to answer.",
      memoryLimitMb: 256,
      outputFormat: "",
      statement: "Guess the hidden number.",
      status: "draft",
      tags: [],
      timeLimitMs: 1000,
      title: "Guess",
      type: "full_source",
      visibility: "private",
    });

    const detail = await problemDomain.getProblemPageData(problem.id);
    expect(detail.interactionFormat).toBe("Print `? x` to ask, `! x` to answer.");
  });

  it("saves edited notes and keeps them across other statement edits", async () => {
    const actor = await teacherActor();
    const problem = await createTestProblem({
      authorId: actor.userId,
      status: "draft",
      visibility: "private",
      judgeConfig: { type: "interactive", interactorLanguage: "python" },
    });
    expect((await problemDomain.getProblemPageData(problem.id)).interactionFormat).toBe("");

    await problemDomain.updateProblemRecord(actor, problem.id, {
      interactionFormat: "The interactor answers `<`, `>` or `=`.",
    });
    await problemDomain.updateProblemRecord(actor, problem.id, { statement: "New body" });

    const detail = await problemDomain.getProblemPageData(problem.id);
    expect(detail).toMatchObject({
      interactionFormat: "The interactor answers `<`, `>` or `=`.",
      statement: "New body",
    });
  });
});
