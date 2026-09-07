import { describe, expect, it } from "vitest";
import {
  courseAssignmentFormSchema,
  examCreateSchema,
  latePenaltyRuleSchema,
} from "@nojv/core";
import { assertLateSubmissionPolicy } from "../../../packages/application/src/shared/late-submission-policy";

const dueAt = "2030-01-02T09:00:00Z";
const closesAt = "2030-01-04T09:00:00Z";
const rule = { type: "daily_late_penalty", perDayPct: 10 } as const;
const assignment = {
  courseId: "course",
  title: "Assignment",
  opensAt: "2030-01-01T09:00:00Z",
  dueAt,
  closesAt,
  allowLateSubmissions: true,
};

describe("late submission settings", () => {
  it.each(["", dueAt, "2030-01-01T09:00:00Z"])(
    "rejects an enabled late window with final time %s",
    (end) => {
      expect(
        courseAssignmentFormSchema.safeParse({ ...assignment, closesAt: end }).success,
      ).toBe(false);
    },
  );
  it("does not require a hidden final time when late submissions are disabled", () => {
    expect(
      courseAssignmentFormSchema.safeParse({
        ...assignment,
        allowLateSubmissions: false,
        closesAt: "",
      }).success,
    ).toBe(true);
  });
  it.each([
    { type: "final_day_zero" },
    { ...rule, startFrom: "due" },
    { ...rule, startFrom: "final_day" },
    { ...rule, perDayPct: -1 },
    { ...rule, perDayPct: 101 },
  ])("rejects retired or invalid penalty %j", (input) => {
    expect(latePenaltyRuleSchema.safeParse(input).success).toBe(false);
  });
  it("requires one penalty, a usable late window and point-sum exam scores", () => {
    expect(() =>
      assertLateSubmissionPolicy([rule], new Date(dueAt), new Date(closesAt), "point_sum"),
    ).not.toThrow();
    expect(() => assertLateSubmissionPolicy([rule], null, new Date(closesAt))).toThrow(
      /deadline|dueAt/,
    );
    expect(() => assertLateSubmissionPolicy([rule], new Date(dueAt), new Date(dueAt))).toThrow(
      /dueAt/,
    );
    expect(() =>
      assertLateSubmissionPolicy([rule, rule], new Date(dueAt), new Date(closesAt)),
    ).toThrow(/one late penalty/);
    expect(() =>
      assertLateSubmissionPolicy([rule], new Date(dueAt), new Date(closesAt), "problem_count"),
    ).toThrow(/point_sum/);
  });
  it("rejects exam due dates outside the exam window", () => {
    const exam = {
      courseId: "course",
      title: "Exam",
      startsAt: assignment.opensAt,
      endsAt: closesAt,
      dueAt,
    };
    expect(examCreateSchema.safeParse(exam).success).toBe(true);
    expect(examCreateSchema.safeParse({ ...exam, dueAt: assignment.opensAt }).success).toBe(
      false,
    );
    expect(examCreateSchema.safeParse({ ...exam, dueAt: "2030-01-05T09:00:00Z" }).success).toBe(
      false,
    );
  });
});
