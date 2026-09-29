import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryStorage } from "../_fixtures/storage";

const { storageRef } = vi.hoisted(() => ({
  storageRef: { client: null as unknown as ReturnType<typeof createInMemoryStorage> },
}));

vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
}));

import {
  pinnedObjects,
  readJudgeSnapshot,
} from "../../../packages/application/src/submission/judge-snapshot";

function put(key: string, content: string) {
  storageRef.client.store.set(key, content);
  return {
    key,
    sha256: createHash("sha256").update(content).digest("hex"),
    size: Buffer.byteLength(content),
  };
}

function snapshot(format: 1 | 2, testcase: Record<string, unknown>) {
  return {
    format,
    sandboxImage: "sandbox@sha256:1",
    submissionId: "sub_1",
    problemGeneration: 3,
    draft: { problemId: "prob_1", language: "cpp", sampleOnly: false },
    context: {
      adjustment: {
        adjustmentRules: null,
        dueAt: null,
        submittedAt: "2026-09-29T00:00:00.000Z",
      },
      checkerScript: null,
      checkerLanguage: null,
      interactorScript: null,
      interactorLanguage: null,
      compareOptions: null,
      judgeType: "standard",
      runtime: { timeLimitMs: 1000, memoryLimitMb: 256, env: {} },
      samples: [],
      problemType: "full_source",
      testcaseSets: [{ id: "set_1", name: "main", weight: 1, testcases: [testcase] }],
      workspaceFiles: [],
      advanced: null,
    },
    sources: [{ path: "main.cpp", content: "int main(){}" }],
  };
}

describe("judge snapshot formats", () => {
  beforeEach(() => {
    storageRef.client = createInMemoryStorage();
  });

  it("reads a format-1 snapshot with embedded testcases unchanged", async () => {
    const testcase = { id: "tc_1", weight: 1, input: "1 2\n", output: "3\n" };
    const pointer = put("snap-1.json", JSON.stringify(snapshot(1, testcase)));
    const read = await readJudgeSnapshot(pointer);
    expect(read.context.testcaseSets[0]?.testcases[0]).toEqual(testcase);
  });

  it("resolves format-2 testcase pointers into contents", async () => {
    const pinned = {
      id: "tc_1",
      weight: 1,
      input: put("in", "1 2\n"),
      output: put("out", "3\n"),
      inputFiles: { "data.txt": put("file", "abc") },
    };
    const pointer = put("snap-2.json", JSON.stringify(snapshot(2, pinned)));
    const read = await readJudgeSnapshot(pointer);
    expect(read.context.testcaseSets[0]?.testcases[0]).toEqual({
      id: "tc_1",
      weight: 1,
      input: "1 2\n",
      output: "3\n",
      inputFiles: { "data.txt": "abc" },
    });
  });

  it("rejects a format-2 snapshot whose pinned object was altered", async () => {
    const input = put("in", "1 2\n");
    storageRef.client.store.set("in", "9 9\n");
    const pointer = put(
      "snap-2.json",
      JSON.stringify(snapshot(2, { id: "tc_1", weight: 1, input })),
    );
    await expect(readJudgeSnapshot(pointer)).rejects.toThrow("SHA-256 mismatch");
  });

  it("lists every pinned object once", () => {
    const input = put("in", "1");
    const output = put("out", "2");
    const parsed = snapshot(2, {
      id: "tc_1",
      weight: 1,
      input,
      output,
      inputFiles: { a: input },
    });
    expect(pinnedObjects(parsed as never)).toEqual([input, output]);
  });
});
