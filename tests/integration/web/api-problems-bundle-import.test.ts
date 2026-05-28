/**
 * Integration coverage for `importBundle` (POST /api/problems/[id]/bundle).
 *
 * The route is a thin wrapper around `problemDomain.importBundle`, so we
 * exercise the domain function directly against the real Postgres + the
 * shared in-memory `@nojv/storage` mock that `integration-setup.ts`
 * installs.
 *
 * Cases (per the storage-unification plan, Task W3.D):
 *  1. happy path: testcases + workspace + checker land in DB and S3
 *  2. reject when uncompressed total exceeds the 50 MB budget
 *  3. reject any entry whose path contains a `..` segment
 *  4. reject any entry whose path is absolute
 *  5. reject when entry count exceeds the 200-entry cap
 */
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";

import { problemDomain } from "@nojv/domain";

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

async function zipBufferFrom(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("importBundle (real Postgres, mocked storage)", () => {
  let seeded: SeededProblem;

  beforeEach(async () => {
    seeded = await seedProblemWithOwner();
  });

  it("imports a valid bundle (testcases + workspace + checker)", async () => {
    const bundle = await zipBufferFrom({
      "testcases/0/input.txt": "1 2\n",
      "testcases/0/answer.txt": "3\n",
      "testcases/1/input.txt": "4 5\n",
      "testcases/1/answer.txt": "9\n",
      "workspace/main.cpp": "int main() { return 0; }\n",
      "checker.py": "print('ok')\n",
    });

    const result = await problemDomain.importBundle(seeded.actor, seeded.problemId, bundle);
    expect(result.testcaseCount).toBe(2);
    expect(result.workspaceCount).toBe(1);

    // Testcase set + cases land in DB. The wholesale replace drops the
    // factory-seeded "sample" set; the new "Imported" set is the only
    // survivor.
    const sets = await testPrisma.testcaseSet.findMany({
      where: { problemId: seeded.problemId },
      include: { testcases: { orderBy: { ordinal: "asc" } } },
      orderBy: { ordinal: "asc" },
    });
    expect(sets).toHaveLength(1);
    expect(sets[0]!.name).toBe("Imported");
    expect(sets[0]!.testcases).toHaveLength(2);

    const workspaceFiles = await testPrisma.problemWorkspaceFile.findMany({
      where: { problemId: seeded.problemId },
    });
    expect(workspaceFiles).toHaveLength(1);
    expect(workspaceFiles[0]!.language).toBe("cpp");
    expect(workspaceFiles[0]!.path).toBe("main.cpp");

    // judgeConfig switches to `checker` and stamps the storage key.
    const problem = await testPrisma.problem.findUniqueOrThrow({
      where: { id: seeded.problemId },
    });
    const judgeConfig = problem.judgeConfig as {
      type: string;
      checkerKey?: string | null;
      checkerLanguage?: string | null;
    };
    expect(judgeConfig.type).toBe("checker");
    expect(judgeConfig.checkerKey).toBe(`problems/${seeded.problemId}/validator/checker`);
    expect(judgeConfig.checkerLanguage).toBe("python");
  });

  it("rejects bundle exceeding 50 MB total uncompressed", async () => {
    // 51 MB of highly-compressible repeated bytes — JSZip's deflate keeps
    // the on-wire size tiny, but the uncompressed sum trips the budget.
    const big = "x".repeat(51 * 1024 * 1024);
    const bundle = await zipBufferFrom({
      "workspace/main.cpp": big,
    });

    await expect(
      problemDomain.importBundle(seeded.actor, seeded.problemId, bundle),
    ).rejects.toThrow(/exceeds .* bytes uncompressed/);
  });

  it("rejects bundle with a path containing ..", async () => {
    const bundle = await zipBufferFrom({
      "workspace/../etc/passwd": "root:x:0:0:root:/root:/bin/bash\n",
    });

    await expect(
      problemDomain.importBundle(seeded.actor, seeded.problemId, bundle),
    ).rejects.toThrow(/Invalid path in bundle/);
  });

  it("rejects bundle with absolute paths", async () => {
    // JSZip preserves the literal leading slash when written via .file().
    const bundle = await zipBufferFrom({
      "/etc/passwd": "root:x:0:0:root:/root:/bin/bash\n",
    });

    await expect(
      problemDomain.importBundle(seeded.actor, seeded.problemId, bundle),
    ).rejects.toThrow(/Invalid path in bundle/);
  });

  it("rejects bundle with > 200 entries", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 201; i++) {
      entries[`testcases/${String(i)}/input.txt`] = `${String(i)}\n`;
    }
    const bundle = await zipBufferFrom(entries);

    await expect(
      problemDomain.importBundle(seeded.actor, seeded.problemId, bundle),
    ).rejects.toThrow(/too many entries/);
  });
});
