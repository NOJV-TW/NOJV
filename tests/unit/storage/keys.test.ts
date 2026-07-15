import { describe, expect, it } from "vitest";

import {
  testcaseInputKey,
  testcaseOutputKey,
  testcaseInputFileKey,
  workspaceFileKey,
  checkerKey,
  interactorKey,
  problemPrefix,
} from "../../../packages/storage/src/keys";

describe("storage key builders", () => {
  const version = "018f4f5d-27b5-7d2e-9f5a-7f4bc2b4a001";

  it("testcaseInputKey returns the canonical input path", () => {
    expect(testcaseInputKey("prob_1", "tc_1", version)).toBe(
      `problems/prob_1/testcases/tc_1/versions/${version}/input`,
    );
  });

  it("testcaseOutputKey returns the canonical output path", () => {
    expect(testcaseOutputKey("prob_1", "tc_1", version)).toBe(
      `problems/prob_1/testcases/tc_1/versions/${version}/output`,
    );
  });

  it("testcaseInputFileKey embeds the filename verbatim", () => {
    expect(testcaseInputFileKey("prob_1", "tc_1", version, "graph.txt")).toBe(
      `problems/prob_1/testcases/tc_1/versions/${version}/files/graph.txt`,
    );
  });

  it("testcaseInputFileKey rejects nested paths and unsafe segments", () => {
    expect(() => testcaseInputFileKey("prob_1", "tc_1", version, "dir/graph.txt")).toThrow();
    expect(() => testcaseInputFileKey("prob_1", "tc_1", version, ".")).toThrow();
    expect(() => testcaseInputFileKey("prob_1", "tc_1", version, "a:b.txt")).toThrow();
  });

  it("workspaceFileKey returns the canonical workspace file path", () => {
    expect(workspaceFileKey("prob_1", "ws_1", version)).toBe(
      `problems/prob_1/workspace/ws_1/versions/${version}`,
    );
  });

  it("checkerKey returns the canonical checker path", () => {
    expect(checkerKey("prob_1", version)).toBe(`problems/prob_1/validators/${version}/checker`);
  });

  it("interactorKey returns the canonical interactor path", () => {
    expect(interactorKey("prob_1", version)).toBe(
      `problems/prob_1/validators/${version}/interactor`,
    );
  });

  it("problemPrefix ends with a trailing slash", () => {
    const prefix = problemPrefix("prob_1");
    expect(prefix).toBe("problems/prob_1/");
    expect(prefix.endsWith("/")).toBe(true);
  });

  it("problemPrefix is a prefix of every per-row key for the same problem", () => {
    const problemId = "prob_42";
    const prefix = problemPrefix(problemId);

    expect(testcaseInputKey(problemId, "tc_a", version).startsWith(prefix)).toBe(true);
    expect(testcaseOutputKey(problemId, "tc_a", version).startsWith(prefix)).toBe(true);
    expect(
      testcaseInputFileKey(problemId, "tc_a", version, "input.txt").startsWith(prefix),
    ).toBe(true);
    expect(workspaceFileKey(problemId, "ws_a", version).startsWith(prefix)).toBe(true);
    expect(checkerKey(problemId, version).startsWith(prefix)).toBe(true);
    expect(interactorKey(problemId, version).startsWith(prefix)).toBe(true);
  });

  it("rejects unsafe version segments", () => {
    expect(() => workspaceFileKey("prob_1", "ws_1", "../current")).toThrow();
    expect(() => checkerKey("prob_1", "current/latest")).toThrow();
  });
});
