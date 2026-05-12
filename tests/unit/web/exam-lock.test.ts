import { describe, expect, it } from "vitest";

import { isAllowedPathForExam, type ActiveExamContext } from "$lib/server/exam-lock";

function makeCtx(overrides: Partial<ActiveExamContext> = {}): ActiveExamContext {
  return {
    session: {
      id: "session-1",
      examId: "exam-1",
      userId: "user-1",
      startedAt: new Date("2026-04-14T00:00:00Z"),
      ipPin: null,
    },
    exam: {
      id: "exam-1",
      courseId: "course-1",
      title: "Midterm",
    },
    course: {
      id: "course-1",
    },
    ...overrides,
  };
}

describe("isAllowedPathForExam", () => {
  const ctx = makeCtx();

  describe("allow list", () => {
    it("allows every /api/* path (heartbeat, release, submit, etc.)", () => {
      expect(isAllowedPathForExam("/api/exam-sessions/exam-1/heartbeat", ctx)).toBe(true);
      expect(isAllowedPathForExam("/api/exam-sessions/exam-1/release", ctx)).toBe(true);
      expect(isAllowedPathForExam("/api/submissions", ctx)).toBe(true);
      expect(isAllowedPathForExam("/api/", ctx)).toBe(true);
    });

    it("allows the exact exam landing path", () => {
      expect(isAllowedPathForExam("/exams/exam-1", ctx)).toBe(true);
    });

    it("allows nested routes under the exam's own subtree", () => {
      expect(isAllowedPathForExam("/exams/exam-1/problems/0", ctx)).toBe(true);
      expect(isAllowedPathForExam("/exams/exam-1/problems/3", ctx)).toBe(true);
      expect(isAllowedPathForExam("/exams/exam-1/summary", ctx)).toBe(true);
    });

    it("allows /signin and /signout so session recovery is possible", () => {
      expect(isAllowedPathForExam("/signin", ctx)).toBe(true);
      expect(isAllowedPathForExam("/signin/", ctx)).toBe(true);
      expect(isAllowedPathForExam("/signin/email", ctx)).toBe(true);
      expect(isAllowedPathForExam("/signout", ctx)).toBe(true);
      expect(isAllowedPathForExam("/signout/", ctx)).toBe(true);
    });
  });

  describe("deny list", () => {
    it("denies unrelated top-level pages", () => {
      expect(isAllowedPathForExam("/", ctx)).toBe(false);
      expect(isAllowedPathForExam("/dashboard", ctx)).toBe(false);
      expect(isAllowedPathForExam("/problems", ctx)).toBe(false);
      expect(isAllowedPathForExam("/contests", ctx)).toBe(false);
    });

    it("denies OTHER exams", () => {
      expect(isAllowedPathForExam("/exams/exam-2", ctx)).toBe(false);
      expect(isAllowedPathForExam("/exams/exam-2/problems/0", ctx)).toBe(false);
    });

    it("denies the parent course tree", () => {
      expect(isAllowedPathForExam("/courses/course-1", ctx)).toBe(false);
      expect(isAllowedPathForExam("/courses/course-1/assignments", ctx)).toBe(false);
    });

    it("denies paths that merely share a prefix with the exam path", () => {
      // `/exams/exam-1` is the prefix; "/exam-10" must not be considered a
      // child of "/exam-1".
      expect(isAllowedPathForExam("/exams/exam-10", ctx)).toBe(false);
      expect(isAllowedPathForExam("/exams/exam-10/problems/0", ctx)).toBe(false);
    });

    it("denies /signup — only /signin is an escape hatch", () => {
      expect(isAllowedPathForExam("/signup", ctx)).toBe(false);
    });
  });
});
