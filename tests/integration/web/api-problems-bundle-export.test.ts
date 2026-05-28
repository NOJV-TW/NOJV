/**
 * Round-trip coverage for `exportBundle` (GET /api/problems/[id]/bundle).
 *
 * Strategy: seed a problem with workspace files, two testcases, and a
 * checker; export it to a zip buffer; wipe the problem's blob prefix +
 * DB rows; re-import the buffer; assert the resulting problem state is
 * equivalent to the pre-export state along the dimensions the bundle
 * format carries (workspace paths + contents, testcase inputs + answers,
 * checker source + language, judgeConfig type).
 *
 * Domain-direct: we call `exportBundle` / `importBundle` on @nojv/domain
 * the same way the W3.A/B/C/D integration tests do — the +server.ts is a
 * thin wrapper and gets no value from being exercised here.
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { problemDomain } from "@nojv/domain";
import {
  checkerKey as checkerKeyFor,
  deleteBlobsByPrefix,
  createStorageClient,
  getText,
  putText,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
} from "@nojv/storage";

import { createTestProblem, testPrisma } from "../../fixtures/factories";
import type { ProblemActorContext } from "../../../packages/domain/src/problem/permissions";

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

/**
 * Wipe the factory's pre-seeded testcase set + sample testcase and replace
 * with the fixtures the round-trip test wants. The factory always inserts a
 * single "sample" set + one testcase; we drop them so the post-export DB
 * state is exactly the bundle's payload (two testcases + workspace + checker).
 */
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

  // Workspace files: random ids; mirror the production write order (S3 put
  // BEFORE DB insert).
  for (const [i, w] of fixtures.workspaceFiles.entries()) {
    const id = randomUUID();
    const contentKey = workspaceFileKey(problemId, id);
    await putText(storage, contentKey, w.content);
    await testPrisma.problemWorkspaceFile.create({
      data: {
        id,
        problemId,
        language: w.language as never,
        path: w.path,
        contentKey,
        visibility: "editable",
        orderIndex: i,
      },
    });
  }

  // Testcases.
  for (const [i, tc] of fixtures.testcases.entries()) {
    const id = randomUUID();
    const inputKey = testcaseInputKey(problemId, id);
    const outputKey = tc.answer !== null ? testcaseOutputKey(problemId, id) : null;
    await putText(storage, inputKey, tc.input);
    if (outputKey !== null && tc.answer !== null) {
      await putText(storage, outputKey, tc.answer);
    }
    await testPrisma.testcase.create({
      data: {
        id,
        testcaseSetId: set.id,
        ordinal: i + 1,
        inputKey,
        ...(outputKey !== null ? { outputKey } : {}),
      },
    });
  }

  // Checker.
  await putText(storage, checkerKeyFor(problemId), fixtures.checker.source);
  await testPrisma.problem.update({
    where: { id: problemId },
    data: {
      judgeConfig: {
        type: "checker",
        checkerKey: checkerKeyFor(problemId),
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
      content: await getText(storage, w.contentKey),
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
      const input = await getText(storage, tc.inputKey);
      const answer = tc.outputKey ? await getText(storage, tc.outputKey) : null;
      flat.push({ input, answer });
    }
  }

  const problem = await testPrisma.problem.findUniqueOrThrow({ where: { id: problemId } });
  const cfg = problem.judgeConfig as {
    type?: string;
    checkerKey?: string | null;
    checkerLanguage?: string | null;
  };
  const checker =
    cfg.checkerKey && cfg.checkerLanguage
      ? { language: cfg.checkerLanguage, source: await getText(storage, cfg.checkerKey) }
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

    const exported = await problemDomain.exportBundle(seeded.actor, seeded.problemId);
    expect(exported).toBeInstanceOf(Buffer);
    expect(exported.byteLength).toBeGreaterThan(0);

    // Wipe DB + S3 prefix so the re-import has to repopulate everything from
    // the zip alone. Bundle import does its own wholesale replace, but
    // clearing S3 first ensures any pre-existing blob can't satisfy the
    // post-import reads by accident.
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

    // Workspace: paths + contents preserved. The bundle format doesn't
    // carry orderIndex, so we compare on the (path-sorted) set of pairs.
    const beforeWorkspace = before.workspace
      .map((w) => ({ path: w.path, content: w.content }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const afterWorkspace = after.workspace
      .map((w) => ({ path: w.path, content: w.content }))
      .sort((a, b) => a.path.localeCompare(b.path));
    expect(afterWorkspace).toEqual(beforeWorkspace);

    // Testcases: inputs + answers preserved in order.
    expect(after.testcases).toEqual(before.testcases);

    // Checker source + language preserved; judgeConfig switches back to
    // `checker`.
    expect(after.checker?.source).toBe(before.checker?.source);
    expect(after.checker?.language).toBe(before.checker?.language);
    expect(after.judgeType).toBe("checker");
  });
});
