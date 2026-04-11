import { describe, expect, it } from "vitest";

import {
  createTestContest,
  createTestProblem,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { contestDomain } from "@nojv/domain";

const { getContestDetail } = contestDomain;

async function attachProblem(contestId: string, ordinal: number, points: number) {
  const problem = await createTestProblem();
  await testPrisma.contestProblem.create({
    data: { contestId, problemId: problem.id, ordinal, points }
  });
  return problem;
}

describe("getContestDetail visibility gating", () => {
  it("hides problems for a stranger before startsAt", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date("2099-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-02T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);

    const stranger = await createTestUser();
    const result = await getContestDetail(contest.slug, {
      userId: stranger.id,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result).not.toBeNull();
    expect(result!.problemsHidden).toBe(true);
    expect(result!.problems).toBeNull();
    expect(result!.isManager).toBe(false);
  });

  it("reveals problems for the contest creator before startsAt", async () => {
    const owner = await createTestUser();
    const contest = await createTestContest({
      visibility: "published",
      createdByUserId: owner.id,
      startsAt: new Date("2099-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-02T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);

    const result = await getContestDetail(contest.slug, {
      userId: owner.id,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result!.problemsHidden).toBe(false);
    expect(result!.problems).toHaveLength(1);
    expect(result!.isManager).toBe(true);
  });

  it("reveals problems to a course teacher before startsAt", async () => {
    const teacher = await createTestUser();
    const course = await testPrisma.course.create({
      data: {
        id: "course-visibility",
        slug: "course-visibility",
        title: "Visibility Course",
        description: "",
        locale: "en",
        visibility: "listed",
        ownerId: teacher.id
      }
    });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: teacher.id, role: "teacher", status: "active" }
    });
    const contest = await createTestContest({
      visibility: "published",
      courseId: course.id,
      startsAt: new Date("2099-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-02T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);

    const result = await getContestDetail(contest.slug, {
      userId: teacher.id,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result!.problemsHidden).toBe(false);
    expect(result!.isManager).toBe(true);
  });

  it("reveals problems to all viewers once the contest is active", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date("2020-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-01T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);
    const stranger = await createTestUser();

    const result = await getContestDetail(contest.slug, {
      userId: stranger.id,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result!.problemsHidden).toBe(false);
    expect(result!.problems).toHaveLength(1);
  });

  it("accepts unauthenticated callers (userId: null) and hides before start", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date("2099-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-02T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);

    const result = await getContestDetail(contest.slug, {
      userId: null,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result!.problemsHidden).toBe(true);
    expect(result!.problems).toBeNull();
  });
});
