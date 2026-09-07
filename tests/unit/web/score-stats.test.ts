import { describe, expect, it } from "vitest";

import { buildAssignmentResults } from "$lib/server/results/assignment";
import { buildExamResults } from "$lib/server/results/exam";

import { buildScoreStats } from "../../../packages/application/src/shared/score-stats";

describe("buildScoreStats", () => {
  it("buckets raw scores around the highest achieved score", () => {
    const stats = buildScoreStats([100, 0], 2, 300);

    expect(stats.buckets).toEqual([
      { label: "90-100", count: 1 },
      { label: "80-89", count: 0 },
      { label: "70-79", count: 0 },
      { label: "60-69", count: 0 },
      { label: "<60", count: 1 },
    ]);
  });

  it("expands bucket labels when the highest score is above 100", () => {
    const stats = buildScoreStats([200, 150, 0], 3, 300);

    expect(stats.buckets[0]).toEqual({ label: "180-200", count: 1 });
    expect(stats.buckets[2]).toEqual({ label: "140-159", count: 1 });
  });

  it("uses exact buckets for small discrete score ranges", () => {
    const stats = buildScoreStats([3, 2, 1, 0], 4, 3);

    expect(stats.buckets).toEqual([
      { label: "3", count: 1 },
      { label: "2", count: 1 },
      { label: "1", count: 1 },
      { label: "0", count: 1 },
    ]);
  });
});

it("keeps pending manual grades in course statistics without fabricating submissions", () => {
  const matrix: Parameters<typeof buildAssignmentResults>[0] = {
    problems: [{ problemId: "problem", letter: "A", ordinal: 1, title: "A", points: 100 }],
    rows: [
      {
        rowId: "pending",
        courseMembershipId: "pending",
        userId: null,
        displayName: "Pending Student",
        handle: "pending_student",
        total: 80,
        cells: [
          {
            problemId: "problem",
            state: "partial",
            score: 80,
            attempts: 0,
            practiceScore: null,
            practiceAttempts: 0,
          },
        ],
      },
      {
        rowId: "linked",
        courseMembershipId: "linked",
        userId: "user",
        displayName: "Student",
        handle: "student",
        total: 0,
        cells: [
          {
            problemId: "problem",
            state: "zero",
            score: 0,
            attempts: 1,
            practiceScore: null,
            practiceAttempts: 0,
          },
        ],
      },
    ],
    studentCount: 2,
    totalPoints: 100,
  };
  for (const stats of [buildAssignmentResults(matrix), buildExamResults(matrix, "user")]) {
    expect(stats.submitted).toBe(1);
    expect(stats.total).toBe(2);
    expect(stats.classAvg).toBe(40);
    expect(stats.max).toBe(80);
  }
  expect(buildExamResults(matrix, "user").rows[0]).toMatchObject({
    user: "Pending Student",
    me: false,
  });
});
