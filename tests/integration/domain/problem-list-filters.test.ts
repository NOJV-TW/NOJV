// Sidebar filter coverage for listProblemCards: problem-type, judge-method
// (incl. the null-judgeConfig => "standard" rule and special_env exclusion),
// per-user status, statusCounts, and the per-card `bookmarked` flag.
//
// These exercise real Prisma `where` clauses (relation filters + JSON path)
// against Postgres — the kind of thing unit mocks can't validate.
import { describe, expect, it } from "vitest";

import { problemDomain } from "@nojv/domain";

import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

const idsOf = (r: { problems: { id: string }[] }) => new Set(r.problems.map((p) => p.id));

describe("listProblemCards — type filter", () => {
  it("returns only the selected problem types", async () => {
    const full = await createTestProblem({ type: "full_source" });
    const multi = await createTestProblem({ type: "multi_file" });
    await createTestProblem({
      type: "special_env",
      advancedImageRef: "img",
      advancedImageSource: "registry",
    });

    const result = await problemDomain.listProblemCards({ types: ["multi_file"] });
    expect(idsOf(result)).toEqual(new Set([multi.id]));

    const both = await problemDomain.listProblemCards({ types: ["full_source", "multi_file"] });
    expect(idsOf(both)).toEqual(new Set([full.id, multi.id]));
  });
});

describe("listProblemCards — judge-method filter", () => {
  it("matches checker problems and excludes others", async () => {
    const checker = await createTestProblem({ judgeConfig: { type: "checker" } });
    await createTestProblem({ judgeConfig: { type: "interactive" } });

    const result = await problemDomain.listProblemCards({ judgeMethods: ["checker"] });
    expect(idsOf(result)).toEqual(new Set([checker.id]));
  });

  it("treats a null judgeConfig as standard", async () => {
    const nullCfg = await createTestProblem({ judgeConfig: undefined });
    const explicit = await createTestProblem({ judgeConfig: { type: "standard" } });
    await createTestProblem({ judgeConfig: { type: "checker" } });

    const result = await problemDomain.listProblemCards({ judgeMethods: ["standard"] });
    expect(idsOf(result)).toEqual(new Set([nullCfg.id, explicit.id]));
  });

  it("excludes special_env problems from any judge-method filter", async () => {
    await createTestProblem({
      type: "special_env",
      advancedImageRef: "img",
      advancedImageSource: "registry",
      judgeConfig: undefined,
    });
    const std = await createTestProblem({ judgeConfig: { type: "standard" } });

    const result = await problemDomain.listProblemCards({ judgeMethods: ["standard"] });
    expect(idsOf(result)).toEqual(new Set([std.id]));
  });
});

describe("listProblemCards — status filter + counts", () => {
  it("partitions solved / attempted / untried and respects bookmarks", async () => {
    const user = await createTestUser();
    const solved = await createTestProblem();
    const attempted = await createTestProblem();
    const untried = await createTestProblem();

    await createTestSubmission({ userId: user.id, problemId: solved.id, status: "accepted" });
    await createTestSubmission({
      userId: user.id,
      problemId: attempted.id,
      status: "wrong_answer",
    });
    await problemDomain.toggleBookmark(user.id, untried.id);

    const solvedR = await problemDomain.listProblemCards({ userId: user.id, status: "solved" });
    expect(idsOf(solvedR)).toEqual(new Set([solved.id]));

    const attemptedR = await problemDomain.listProblemCards({
      userId: user.id,
      status: "attempted",
    });
    expect(idsOf(attemptedR)).toEqual(new Set([attempted.id]));

    const untriedR = await problemDomain.listProblemCards({
      userId: user.id,
      status: "untried",
    });
    expect(idsOf(untriedR)).toEqual(new Set([untried.id]));

    const bookmarkedR = await problemDomain.listProblemCards({
      userId: user.id,
      status: "bookmarked",
    });
    expect(idsOf(bookmarkedR)).toEqual(new Set([untried.id]));

    expect(solvedR.statusCounts).toEqual({
      all: 3,
      solved: 1,
      attempted: 1,
      untried: 1,
      bookmarked: 1,
    });
  });

  it("returns null statusCounts for anonymous viewers", async () => {
    await createTestProblem();
    const result = await problemDomain.listProblemCards({});
    expect(result.statusCounts).toBeNull();
  });
});

describe("listProblemCards — per-card bookmarked flag", () => {
  it("flags bookmarked cards for the requesting user only", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    const problem = await createTestProblem();
    await problemDomain.toggleBookmark(user.id, problem.id);

    const mine = await problemDomain.listProblemCards({ userId: user.id });
    expect(mine.problems.find((p) => p.id === problem.id)?.bookmarked).toBe(true);

    const theirs = await problemDomain.listProblemCards({ userId: other.id });
    expect(theirs.problems.find((p) => p.id === problem.id)?.bookmarked).toBe(false);

    const anon = await problemDomain.listProblemCards({});
    expect(anon.problems.find((p) => p.id === problem.id)?.bookmarked).toBe(false);
  });
});
