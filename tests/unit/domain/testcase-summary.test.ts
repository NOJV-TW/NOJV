import { describe, expect, it, vi } from "vitest";
import type * as Storage from "@nojv/storage";

vi.mock("@nojv/storage", async (importOriginal) => {
  const original = await importOriginal<typeof Storage>();
  return {
    ...original,
    createStorageClient: vi.fn(() => {
      throw new Error("summarizeTestcaseSets must not touch object storage");
    }),
  };
});

const { summarizeTestcaseSets } =
  await import("../../../packages/application/src/problem/blobs");

function pointer(key: string, size: number) {
  return { key, sha256: "a".repeat(64), size };
}

describe("summarizeTestcaseSets", () => {
  it("reports sizes from persisted pointers without reading object storage", () => {
    const [set] = summarizeTestcaseSets([
      {
        id: "set-1",
        name: "Subtask 1",
        testcases: [
          {
            id: "tc-1",
            ordinal: 1,
            inputStorage: pointer("problems/p/testcases/tc-1/input", 8_955_905),
            outputStorage: pointer("problems/p/testcases/tc-1/output", 900_001),
          },
          {
            id: "tc-2",
            ordinal: 2,
            inputStorage: pointer("problems/p/testcases/tc-2/input", 12),
            outputStorage: null,
          },
        ],
      },
    ]);

    expect(set?.testcases).toEqual([
      { id: "tc-1", ordinal: 1, inputSize: 8_955_905, outputSize: 900_001 },
      { id: "tc-2", ordinal: 2, inputSize: 12, outputSize: null },
    ]);
  });

  it("rejects malformed pointers", () => {
    expect(() =>
      summarizeTestcaseSets([
        {
          id: "set-1",
          testcases: [{ id: "tc-1", inputStorage: { key: "x" }, outputStorage: null }],
        },
      ]),
    ).toThrow();
  });
});
