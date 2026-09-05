import JSZip from "jszip";
import { expect, it } from "vitest";

import { problemDomain } from "@nojv/application";
import { createTestProblem, createTestUser, testPrisma } from "../../fixtures/factories";

it("rejects corrupt judge configuration consistently without rewriting persisted data", async () => {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const problem = await createTestProblem({ authorId: teacher.id, status: "draft" });
  const originalSets = await testPrisma.testcaseSet.findMany({
    where: { problemId: problem.id },
  });
  const corrupt = { type: "standard", runtime: { memoryLimitMb: "broken" } };
  await testPrisma.problem.update({
    where: { id: problem.id },
    data: { judgeConfig: corrupt },
  });
  const actor = {
    userId: teacher.id,
    username: teacher.username,
    platformRole: teacher.platformRole,
  };
  const zip = new JSZip();
  zip.file("testcases/0/input.txt", "1");
  zip.file("testcases/0/answer.txt", "1");
  const bundle = await zip.generateAsync({ type: "nodebuffer" });

  const operations = [
    () => problemDomain.getProblemPageData(problem.id),
    () => problemDomain.exportBundle(actor, problem.id),
    () => problemDomain.importBundle(actor, problem.id, bundle),
    () =>
      problemDomain.setProblemChecker(actor, problem.id, {
        content: "accept()",
        language: "python",
      }),
    () =>
      problemDomain.setProblemInteractor(actor, problem.id, {
        content: "accept()",
        language: "python",
      }),
    () =>
      problemDomain.updateProblemWorkspace(actor, problem.id, {
        files: [],
        runtime: { timeLimitMs: 1000, memoryLimitMb: 256, env: {} },
      }),
  ];
  for (const operation of operations) {
    await expect(operation()).rejects.toThrow(`Invalid judgeConfig for problem ${problem.id}`);
    await expect(
      testPrisma.problem.findUniqueOrThrow({ where: { id: problem.id } }),
    ).resolves.toMatchObject({
      judgeConfig: corrupt,
      checkerStorage: null,
      interactorStorage: null,
    });
  }
  expect(await testPrisma.testcaseSet.findMany({ where: { problemId: problem.id } })).toEqual(
    originalSets,
  );
});
