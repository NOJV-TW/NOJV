import { describe, expect, it } from "vitest";
import { ConflictError, problemDomain } from "@nojv/application";
import { assertStorageObjectPointer } from "@nojv/storage";
import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

describe("draft deletion after reference verification", () => {
  it.each(["reference", "ordinary", "running"] as const)(
    "handles %s submissions without losing protected history",
    async (kind) => {
      const user = await createTestUser({ platformRole: "teacher" });
      const problem = await createTestProblem({ authorId: user.id, status: "draft" });
      const submission = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        isReferenceSolution: kind !== "ordinary",
        status: kind === "running" ? "running" : "accepted",
      });
      if (kind === "reference") {
        await testPrisma.problem.update({
          where: { id: problem.id },
          data: { referenceSolutionSubmissionId: submission.id },
        });
      }
      const actor = {
        userId: user.id,
        username: user.username!,
        displayName: user.name,
        email: user.email,
        platformRole: "teacher" as const,
      };
      if (kind !== "reference") {
        await expect(problemDomain.deleteProblemRecord(actor, problem.id)).rejects.toThrow();
        expect(await testPrisma.problem.count({ where: { id: problem.id } })).toBe(1);
        expect(await testPrisma.submission.count({ where: { id: submission.id } })).toBe(1);
        return;
      }
      await problemDomain.deleteProblemRecord(actor, problem.id);
      expect(await testPrisma.problem.count({ where: { id: problem.id } })).toBe(0);
      expect(await testPrisma.submission.count({ where: { id: submission.id } })).toBe(0);
      const cleanup = await testPrisma.durableWork.findMany({
        where: { kind: "storage.object.cleanup", status: "pending" },
      });
      const keys = cleanup.map(
        (work) => (work.payload as { pointer: { key: string } }).pointer.key,
      );
      expect(keys).toEqual(
        expect.arrayContaining([
          assertStorageObjectPointer(submission.sourceStorage).key,
          assertStorageObjectPointer(submission.verdictDetailStorage).key,
        ]),
      );
    },
  );
});

it("preserves a reference when a concurrent judge run starts before deletion", async () => {
  const user = await createTestUser({ platformRole: "teacher" });
  const problem = await createTestProblem({ authorId: user.id, status: "draft" });
  const reference = await createTestSubmission({
    userId: user.id,
    problemId: problem.id,
    isReferenceSolution: true,
    status: "accepted",
  });
  const locked = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const judging = testPrisma.$transaction(
    async (tx) => {
      const [connection] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      await tx.submission.update({
        where: { id: reference.id },
        data: { status: "running", activeJudgeRunId: "concurrent-run" },
      });
      locked.resolve(connection!.pid);
      await release.promise;
    },
    { timeout: 10000 },
  );
  const pid = await locked.promise;
  const deletion = problemDomain
    .deleteProblemRecord(
      {
        userId: user.id,
        username: user.username!,
        displayName: user.name,
        email: user.email,
        platformRole: "teacher",
      },
      problem.id,
    )
    .then(
      () => null,
      (error: unknown) => error,
    );
  try {
    await expect
      .poll(async () => {
        const [result] = await testPrisma.$queryRaw<
          { blocked: boolean }[]
        >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        return result!.blocked;
      })
      .toBe(true);
  } finally {
    release.resolve();
  }
  await judging;
  expect(await deletion).toBeInstanceOf(ConflictError);
  expect(
    await testPrisma.submission.count({ where: { id: reference.id, status: "running" } }),
  ).toBe(1);
});
