import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { problemDomain } from "@nojv/application";
import {
  assertStorageObjectPointer,
  checkerKey as checkerKeyFor,
  createStorageClient,
  deleteBlobsByPrefix,
  getVerifiedText,
  putImmutableText,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
} from "@nojv/storage";

import { createTestProblem, testPrisma } from "../../fixtures/factories";
import type { ProblemActorContext } from "../../../packages/application/src/problem/permissions";

interface SeededProblem {
  problemId: string;
  actor: ProblemActorContext;
}

async function seedProblemWithOwner(): Promise<SeededProblem> {
  const problem = await createTestProblem({ status: "draft" });
  if (!problem.authorId) throw new Error("createTestProblem produced no authorId");
  const author = await testPrisma.user.findUniqueOrThrow({ where: { id: problem.authorId } });
  return {
    problemId: problem.id,
    actor: {
      userId: author.id,
      username: author.username ?? author.id,
      platformRole: author.platformRole,
    },
  };
}

async function seedFixtures(problemId: string): Promise<{
  workspaceFiles: { language: string; path: string; content: string }[];
  testcases: { input: string; answer: string | null }[];
  checker: { language: "python"; source: string };
}> {
  const storage = createStorageClient();

  await testPrisma.testcase.deleteMany({
    where: { testcaseSet: { problemId } },
  });
  await testPrisma.testcaseSet.deleteMany({ where: { problemId } });

  const set = await testPrisma.testcaseSet.create({
    data: { problemId, name: "Round-trip", weight: 1, ordinal: 0 },
  });

  const fixtures = {
    workspaceFiles: [
      {
        language: "cpp",
        path: "main.cpp",
        content:
          "#include <iostream>\nint main() { int a, b; std::cin >> a >> b; std::cout << a + b; }\n",
      },
      {
        language: "cpp",
        path: "helper.cpp",
        content: "// helper translation unit\n",
      },
    ],
    testcases: [
      { input: "1 2\n", answer: "3\n" },
      { input: "10 20\n", answer: "30\n" },
    ],
    checker: { language: "python" as const, source: "import sys\nprint('ok')\n" },
  };

  let activeStorageBytes = 0;

  for (const [i, w] of fixtures.workspaceFiles.entries()) {
    const id = randomUUID();
    const contentStorage = await putImmutableText(
      storage,
      workspaceFileKey(problemId, id, randomUUID()),
      w.content,
    );
    activeStorageBytes += contentStorage.size;
    await testPrisma.problemWorkspaceFile.create({
      data: {
        id,
        problemId,
        language: w.language as never,
        path: w.path,
        contentStorage,
        visibility: "editable",
        orderIndex: i,
      },
    });
  }

  for (const [i, tc] of fixtures.testcases.entries()) {
    const id = randomUUID();
    const version = randomUUID();
    const inputStorage = await putImmutableText(
      storage,
      testcaseInputKey(problemId, id, version),
      tc.input,
    );
    const outputStorage =
      tc.answer === null
        ? null
        : await putImmutableText(storage, testcaseOutputKey(problemId, id, version), tc.answer);
    activeStorageBytes += inputStorage.size + (outputStorage?.size ?? 0);
    await testPrisma.testcase.create({
      data: {
        id,
        testcaseSetId: set.id,
        ordinal: i + 1,
        inputStorage,
        ...(outputStorage !== null ? { outputStorage } : {}),
      },
    });
  }

  const checkerStorage = await putImmutableText(
    storage,
    checkerKeyFor(problemId, randomUUID()),
    fixtures.checker.source,
  );
  activeStorageBytes += checkerStorage.size;
  await testPrisma.problem.update({
    where: { id: problemId },
    data: {
      activeStorageBytes,
      checkerStorage,
      judgeConfig: {
        type: "checker",
        checkerLanguage: fixtures.checker.language,
      },
    },
  });

  return fixtures;
}

interface Snapshot {
  workspace: { language: string; path: string; content: string }[];
  testcases: { input: string; answer: string | null }[];
  checker: { language: string; source: string } | null;
  judgeType: string;
}

async function snapshot(problemId: string): Promise<Snapshot> {
  const storage = createStorageClient();

  const workspaceRows = await testPrisma.problemWorkspaceFile.findMany({
    where: { problemId },
    orderBy: [{ path: "asc" }],
  });
  const workspace = await Promise.all(
    workspaceRows.map(async (w) => ({
      language: w.language,
      path: w.path,
      content: await getVerifiedText(storage, assertStorageObjectPointer(w.contentStorage)),
    })),
  );

  const sets = await testPrisma.testcaseSet.findMany({
    where: { problemId },
    include: { testcases: { orderBy: { ordinal: "asc" } } },
    orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }],
  });
  const flat: { input: string; answer: string | null }[] = [];
  for (const set of sets) {
    for (const tc of set.testcases) {
      const input = await getVerifiedText(storage, assertStorageObjectPointer(tc.inputStorage));
      const answer =
        tc.outputStorage === null
          ? null
          : await getVerifiedText(storage, assertStorageObjectPointer(tc.outputStorage));
      flat.push({ input, answer });
    }
  }

  const problem = await testPrisma.problem.findUniqueOrThrow({ where: { id: problemId } });
  const cfg = problem.judgeConfig as {
    type?: string;
    checkerLanguage?: string | null;
  };
  const checker =
    problem.checkerStorage && cfg.checkerLanguage
      ? {
          language: cfg.checkerLanguage,
          source: await getVerifiedText(
            storage,
            assertStorageObjectPointer(problem.checkerStorage),
          ),
        }
      : null;

  return {
    workspace,
    testcases: flat,
    checker,
    judgeType: cfg.type ?? "standard",
  };
}

describe("exportBundle round-trip (real Postgres, mocked storage)", () => {
  let seeded: SeededProblem;

  beforeEach(async () => {
    seeded = await seedProblemWithOwner();
  });

  it("export → wipe → import yields equivalent problem state", async () => {
    await seedFixtures(seeded.problemId);

    const before = await snapshot(seeded.problemId);

    const exportedStream = await problemDomain.exportBundle(seeded.actor, seeded.problemId);
    const reader = exportedStream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const exported = Buffer.concat(chunks);
    expect(exported).toBeInstanceOf(Buffer);
    expect(exported.byteLength).toBeGreaterThan(0);

    await testPrisma.testcase.deleteMany({
      where: { testcaseSet: { problemId: seeded.problemId } },
    });
    await testPrisma.testcaseSet.deleteMany({ where: { problemId: seeded.problemId } });
    await testPrisma.problemWorkspaceFile.deleteMany({
      where: { problemId: seeded.problemId },
    });
    await testPrisma.problem.update({
      where: { id: seeded.problemId },
      data: { judgeConfig: { type: "standard" } },
    });
    await deleteBlobsByPrefix(createStorageClient(), `problems/${seeded.problemId}/`);

    const result = await problemDomain.importBundle(seeded.actor, seeded.problemId, exported);
    expect(result.testcaseCount).toBe(before.testcases.length);
    expect(result.workspaceCount).toBe(before.workspace.length);

    const after = await snapshot(seeded.problemId);

    const beforeWorkspace = before.workspace
      .map((w) => ({ path: w.path, content: w.content }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const afterWorkspace = after.workspace
      .map((w) => ({ path: w.path, content: w.content }))
      .sort((a, b) => a.path.localeCompare(b.path));
    expect(afterWorkspace).toEqual(beforeWorkspace);

    expect(after.testcases).toEqual(before.testcases);

    expect(after.checker?.source).toBe(before.checker?.source);
    expect(after.checker?.language).toBe(before.checker?.language);
    expect(after.judgeType).toBe("checker");
  });
});
