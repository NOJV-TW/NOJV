import { describe, expect, it } from "vitest";

import { createTestProblem, testPrisma } from "../../fixtures/factories";

describe("Problem.displayId (real DB)", () => {
  it("assigns unique, monotonically increasing displayIds to new problems", async () => {
    const baseline = (await testPrisma.problem.aggregate({ _max: { displayId: true } }))._max
      .displayId;
    const start = baseline ?? 0;

    const a = await createTestProblem();
    const b = await createTestProblem();
    const c = await createTestProblem();

    expect(a.displayId).toBe(start + 1);
    expect(b.displayId).toBe(start + 2);
    expect(c.displayId).toBe(start + 3);
  });

  it("never reuses a displayId after deletion", async () => {
    const a = await createTestProblem();
    const skippedId = a.displayId;

    await testPrisma.problem.delete({ where: { id: a.id } });

    const b = await createTestProblem();
    expect(b.displayId).toBeGreaterThan(skippedId);
  });
});
