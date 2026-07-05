import { describe, expect, it } from "vitest";

import { createTestProblem, testPrisma } from "../../fixtures/factories";

describe("Problem.displayId (real DB)", () => {
  it("drafts have no displayId; published problems get one", async () => {
    const draft = await createTestProblem({ status: "draft" });
    expect(draft.displayId).toBeNull();

    const published = await createTestProblem({ status: "published" });
    expect(published.displayId).not.toBeNull();
  });

  it("assigns unique, increasing displayIds as problems are published", async () => {
    const baseline =
      (await testPrisma.problem.aggregate({ _max: { displayId: true } }))._max.displayId ?? 0;

    const a = await createTestProblem();
    const b = await createTestProblem();
    const c = await createTestProblem();

    expect(a.displayId).toBe(baseline + 1);
    expect(b.displayId).toBe(baseline + 2);
    expect(c.displayId).toBe(baseline + 3);
  });
});
