import { expect, it } from "vitest";

import { buildAssessmentResults } from "#lib/server/results/assessment.js";

it("keeps pending manual grades in course statistics without fabricating submissions", () => {
  const matrix: Parameters<typeof buildAssessmentResults>[0] = {
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
  const stats = buildAssessmentResults(matrix);
  expect(stats.submitted).toBe(1);
  expect(stats.total).toBe(2);
  expect(stats.classAvg).toBe(40);
  expect(stats.max).toBe(80);
  expect(stats.buckets).toHaveLength(10);
  expect(stats.buckets[1]?.count).toBe(1);
  expect(stats.buckets[9]?.count).toBe(1);
});
