import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";

import { problemDomain } from "@nojv/application";

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
    const big = "x".repeat(51 * 1024 * 1024);
    const bundle = await zipBufferFrom({
      "workspace/main.cpp": big,
    });

    await expect(
      problemDomain.importBundle(seeded.actor, seeded.problemId, bundle),
    ).rejects.toThrow(/bytes uncompressed|pushes inflated total/i);
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
    const bundle = await zipBufferFrom({
      "/etc/passwd": "root:x:0:0:root:/root:/bin/bash\n",
    });

    await expect(
      problemDomain.importBundle(seeded.actor, seeded.problemId, bundle),
    ).rejects.toThrow(/Invalid path in bundle/);
  });

  it("rejects workspace files whose language cannot be inferred", async () => {
    const bundle = await zipBufferFrom({
      "workspace/README.md": "# not source\n",
    });

    await expect(
      problemDomain.importBundle(seeded.actor, seeded.problemId, bundle),
    ).rejects.toThrow(/Unsupported workspace file extension/);
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

  it("rejects deflate-bomb whose central-dir uncompressedSize lies (H3)", async () => {
    const payload = "x".repeat(51 * 1024 * 1024);
    const bundle = await zipBufferFrom({ "workspace/main.cpp": payload });

    const CFH_SIGNATURE = 0x02014b50;
    const LFH_SIGNATURE = 0x04034b50;
    for (let i = 0; i + 4 <= bundle.length; i++) {
      if (bundle.readUInt32LE(i) === LFH_SIGNATURE) {
        bundle.writeUInt32LE(1, i + 22);
      } else if (bundle.readUInt32LE(i) === CFH_SIGNATURE) {
        bundle.writeUInt32LE(1, i + 24);
      }
    }

    await expect(
      problemDomain.importBundle(seeded.actor, seeded.problemId, bundle),
    ).rejects.toThrow(/bytes uncompressed|pushes inflated total/i);
  });

  it("allows re-importing an unchanged 35 MB bundle on a 35 MB problem (M2)", async () => {
    const payload = "y".repeat(35 * 1024 * 1024);
    const bundle = await zipBufferFrom({
      "testcases/0/input.txt": payload,
    });

    await problemDomain.importBundle(seeded.actor, seeded.problemId, bundle);

    const result = await problemDomain.importBundle(seeded.actor, seeded.problemId, bundle);
    expect(result.testcaseCount).toBe(1);
  });
});
