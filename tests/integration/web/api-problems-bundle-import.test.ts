/**
 * Integration coverage for `importBundle` (POST /api/problems/[id]/bundle).
 *
 * The route is a thin wrapper around `problemDomain.importBundle`, so we
 * exercise the domain function directly against the real Postgres + the
 * shared in-memory `@nojv/storage` mock that `integration-setup.ts`
 * installs.
 *
 * Cases:
 *  1. happy path: testcases + workspace + checker land in DB and S3
 *  2. reject when uncompressed total exceeds the 50 MB budget
 *  3. reject any entry whose path contains a `..` segment
 *  4. reject any entry whose path is absolute
 *  5. reject when entry count exceeds the 200-entry cap
 *  6. deflate-bomb rejected — uncompressedSize lies, but stream enforces cap (H3)
 *  7. re-importing an unchanged bundle on an at-budget problem succeeds (M2)
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
    // the on-wire size tiny, but the streamed inflated size trips the cap.
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

  /**
   * H3 — deflate-bomb defense.
   *
   * The central directory's `uncompressedSize` field is attacker-
   * controlled. An attacker can build a zip whose central directory
   * declares each entry as a few bytes while the actual deflate stream
   * inflates to many megabytes. The old `importBundle` summed those
   * declared sizes against the 50 MB cap and then called `entry.buffer()`
   * which inflates without a per-entry stream cap → OOM.
   *
   * Defense: read each entry as a stream, count INFLATED bytes as they
   * arrive, and reject when cumulative bytes exceed the cap.
   *
   * Construction: build a real zip with one large highly-compressible
   * payload (51 MB of repeated bytes deflates to ~50 KB), then patch the
   * central-directory `uncompressedSize` field to claim it's 1 byte.
   * After the patch the central-dir total is < 50 MB (so the old code's
   * pre-check would have passed), but the actual stream emits 51 MB.
   */
  it("rejects deflate-bomb whose central-dir uncompressedSize lies (H3)", async () => {
    const payload = "x".repeat(51 * 1024 * 1024);
    const bundle = await zipBufferFrom({ "workspace/main.cpp": payload });

    // Patch the central-directory `uncompressedSize` (offset +24 from
    // each central-file-header signature 0x02014b50) and the local file
    // header `uncompressedSize` (offset +22 from each local-header
    // signature 0x04034b50). Both fields are 4-byte LE uint32s — set
    // them to 1 to defeat any sum-of-declared-sizes pre-check.
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

  /**
   * M2 — re-import double-counts budget.
   *
   * The old code called `assertProblemStorageBudget(problemId,
   * parsed.totalBytes)` which checks `current + new > 50 MB`. But
   * import is wholesale REPLACE — current usage is about to be wiped.
   * Re-importing the same 35 MB bundle on a 35 MB problem would have
   * failed with 35 + 35 = 70 > 50.
   *
   * Fix: the bundle's own inflated size is enforced against 50 MB; the
   * pre-state is irrelevant because it's about to be replaced.
   */
  it("allows re-importing an unchanged 35 MB bundle on a 35 MB problem (M2)", async () => {
    // 35 MB of highly compressible bytes — zip stays tiny on the wire.
    const payload = "y".repeat(35 * 1024 * 1024);
    const bundle = await zipBufferFrom({
      "testcases/0/input.txt": payload,
    });

    // First import primes the storage at 35 MB.
    await problemDomain.importBundle(seeded.actor, seeded.problemId, bundle);

    // Second import of the SAME bundle — under the old code this would
    // double-count (current 35 + new 35 > 50 cap) and reject.
    const result = await problemDomain.importBundle(seeded.actor, seeded.problemId, bundle);
    expect(result.testcaseCount).toBe(1);
  });
});
