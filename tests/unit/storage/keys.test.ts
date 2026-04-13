import { describe, expect, it } from "vitest";

import {
  testcaseInputKey,
  testcaseOutputKey,
  testcaseInputFileKey,
  workspaceFileKey,
  problemPrefix
} from "../../../packages/storage/src/keys";

describe("storage key builders", () => {
  it("testcaseInputKey returns the canonical input path", () => {
    expect(testcaseInputKey("prob_1", "tc_1")).toBe("problems/prob_1/testcases/tc_1/input");
  });

  it("testcaseOutputKey returns the canonical output path", () => {
    expect(testcaseOutputKey("prob_1", "tc_1")).toBe("problems/prob_1/testcases/tc_1/output");
  });

  it("testcaseInputFileKey embeds the filename verbatim", () => {
    expect(testcaseInputFileKey("prob_1", "tc_1", "graph.txt")).toBe(
      "problems/prob_1/testcases/tc_1/files/graph.txt"
    );
  });

  it("workspaceFileKey returns the canonical workspace file path", () => {
    expect(workspaceFileKey("prob_1", "ws_1")).toBe("problems/prob_1/workspace/ws_1");
  });

  it("problemPrefix ends with a trailing slash", () => {
    const prefix = problemPrefix("prob_1");
    expect(prefix).toBe("problems/prob_1/");
    expect(prefix.endsWith("/")).toBe(true);
  });

  it("problemPrefix is a prefix of every per-row key for the same problem", () => {
    const problemId = "prob_42";
    const prefix = problemPrefix(problemId);

    expect(testcaseInputKey(problemId, "tc_a").startsWith(prefix)).toBe(true);
    expect(testcaseOutputKey(problemId, "tc_a").startsWith(prefix)).toBe(true);
    expect(testcaseInputFileKey(problemId, "tc_a", "input.txt").startsWith(prefix)).toBe(true);
    expect(workspaceFileKey(problemId, "ws_a").startsWith(prefix)).toBe(true);
  });
});
