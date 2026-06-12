import { describe, expect, it } from "vitest";

import { problemDomain } from "@nojv/domain";

import { createTestProblem, createTestUser } from "../../fixtures/factories";

describe("toggleBookmark", () => {
  it("adds then removes a bookmark on repeated toggles", async () => {
    const user = await createTestUser();
    const problem = await createTestProblem();

    expect(await problemDomain.isBookmarked(user.id, problem.id)).toBe(false);

    const first = await problemDomain.toggleBookmark(user.id, problem.id);
    expect(first).toEqual({ bookmarked: true });
    expect(await problemDomain.isBookmarked(user.id, problem.id)).toBe(true);

    const second = await problemDomain.toggleBookmark(user.id, problem.id);
    expect(second).toEqual({ bookmarked: false });
    expect(await problemDomain.isBookmarked(user.id, problem.id)).toBe(false);
  });

  it("throws NotFoundError for an unknown problem", async () => {
    const user = await createTestUser();
    await expect(problemDomain.toggleBookmark(user.id, "does-not-exist")).rejects.toThrow();
  });
});
