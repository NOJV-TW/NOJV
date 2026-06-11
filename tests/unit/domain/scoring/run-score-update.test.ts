import { describe, expect, it, vi } from "vitest";

import {
  runScoreUpdate,
  type ScoringUpdate,
} from "../../../../packages/domain/src/scoring/run-score-update";
import { ConflictError } from "../../../../packages/domain/src/shared/errors";

interface P {
  id: string;
}

function adapter(over: Partial<ScoringUpdate<P>> = {}): ScoringUpdate<P> {
  return {
    load: vi.fn(() => Promise.resolve<P | null>({ id: "p1" })),
    submissions: vi.fn(() => Promise.resolve([])),
    overrides: vi.fn(() => Promise.resolve([])),
    problemIds: vi.fn(() => new Set<string>()),
    scoringMode: vi.fn(() => "point_sum" as const),
    startsAt: vi.fn(() => new Date(0)),
    userId: vi.fn(() => "u1"),
    persist: vi.fn(() => Promise.resolve()),
    isConflict: vi.fn(() => false),
    ...over,
  };
}

describe("runScoreUpdate — shared score-update retry loop", () => {
  it("point_sum: persists best-score state and loads overrides once", async () => {
    const a = adapter();
    const result = await runScoreUpdate("p1", a);

    expect(result).toEqual({ id: "p1" });
    expect(a.overrides).toHaveBeenCalledTimes(1);
    expect(a.persist).toHaveBeenCalledWith({ id: "p1" }, { score: 0, subtaskScores: {} });
  });

  it("problem_count: persists penalty state and skips overrides", async () => {
    const a = adapter({ scoringMode: vi.fn(() => "problem_count" as const) });
    await runScoreUpdate("p1", a);

    expect(a.overrides).not.toHaveBeenCalled();
    expect(a.persist).toHaveBeenCalledWith({ id: "p1" }, { score: 0, penaltySeconds: 0 });
  });

  it("no-ops (returns null) when the participation is gone", async () => {
    const a = adapter({ load: vi.fn(() => Promise.resolve<P | null>(null)) });
    const result = await runScoreUpdate("p1", a);

    expect(result).toBeNull();
    expect(a.persist).not.toHaveBeenCalled();
  });

  it("retries on a version conflict and succeeds on the next attempt", async () => {
    const conflict = new Error("conflict");
    const persist = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(undefined);
    const a = adapter({ persist, isConflict: (e) => e === conflict });

    const result = await runScoreUpdate("p1", a);

    expect(result).toEqual({ id: "p1" });
    expect(a.load).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("throws ConflictError after the attempt budget is exhausted", async () => {
    const a = adapter({
      persist: vi.fn().mockRejectedValue(new Error("c")),
      isConflict: () => true,
    });

    await expect(runScoreUpdate("p1", a)).rejects.toBeInstanceOf(ConflictError);
    expect(a.load).toHaveBeenCalledTimes(3);
  });

  it("rethrows a non-conflict error without retrying", async () => {
    const boom = new Error("boom");
    const a = adapter({ persist: vi.fn().mockRejectedValue(boom), isConflict: () => false });

    await expect(runScoreUpdate("p1", a)).rejects.toBe(boom);
    expect(a.load).toHaveBeenCalledTimes(1);
  });
});
