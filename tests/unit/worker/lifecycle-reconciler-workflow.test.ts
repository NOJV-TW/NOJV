import { describe, expect, it, vi } from "vitest";

import { drainLifecycleReconciliation } from "../../../apps/worker/src/workflows/lifecycle-reconciler";

describe("lifecycle reconciler workflow", () => {
  it("continues as new with the next bounded keyset page", async () => {
    const next = {
      exams: { afterId: "exam_20" },
      contests: null,
      assignments: { afterId: "assignment_20" },
    } as const;
    const reconcile = vi.fn().mockResolvedValue({
      exams: 20,
      contests: 3,
      assignments: 20,
      next,
    });
    const continueRun = vi.fn().mockResolvedValue(undefined);

    await drainLifecycleReconciliation(reconcile, continueRun);

    expect(reconcile).toHaveBeenCalledWith({});
    expect(continueRun).toHaveBeenCalledWith(next);
  });

  it("finishes the cron run when every kind reaches the end of its keyset", async () => {
    const reconcile = vi.fn().mockResolvedValue({
      exams: 1,
      contests: 0,
      assignments: 0,
      next: null,
    });
    const continueRun = vi.fn();

    await drainLifecycleReconciliation(reconcile, continueRun, {
      exams: { afterId: "exam_19" },
      contests: null,
      assignments: null,
    });

    expect(continueRun).not.toHaveBeenCalled();
  });
});
