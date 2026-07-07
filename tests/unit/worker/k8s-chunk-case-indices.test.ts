import { describe, expect, it } from "vitest";

import { chunkCaseIndices } from "../../../apps/worker/src/services/k8s-executor";

describe("chunkCaseIndices — quota-aware per-case waves", () => {
  it("splits case indices into sequential waves of at most `size`", () => {
    const waves = chunkCaseIndices([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
    expect(waves).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
  });

  it("keeps a single wave when the case count fits the parallelism budget", () => {
    expect(chunkCaseIndices([0, 1, 2], 4)).toEqual([[0, 1, 2]]);
  });

  it("preserves overall testcase ordering when flattened back", () => {
    const indices = Array.from({ length: 23 }, (_, i) => i);
    const waves = chunkCaseIndices(indices, 4);
    expect(waves.flat()).toEqual(indices);
    for (const wave of waves) {
      expect(wave.length).toBeLessThanOrEqual(4);
    }
  });

  it("never produces empty chunks even with a non-positive size", () => {
    expect(chunkCaseIndices([0, 1, 2], 0)).toEqual([[0], [1], [2]]);
  });

  it("returns no waves for an empty case set", () => {
    expect(chunkCaseIndices([], 4)).toEqual([]);
  });
});
