import { describe, expect, it } from "vitest";

import {
  isAllowedPathForExam,
  isExamForbiddenApiRequest,
  resolveExamGateDenial,
  type ActiveExamContext,
} from "$lib/server/exam-lock";

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
    it("allows every /api/* path (submissions, release, clarifications, etc.)", () => {
      expect(isAllowedPathForExam("/api/clarifications", ctx)).toBe(true);
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
      expect(isAllowedPathForExam("/exams/exam-10", ctx)).toBe(false);
      expect(isAllowedPathForExam("/exams/exam-10/problems/0", ctx)).toBe(false);
    });

    it("denies /signup — only /signin is an escape hatch", () => {
      expect(isAllowedPathForExam("/signup", ctx)).toBe(false);
    });
  });
});

describe("isExamForbiddenApiRequest", () => {
  it("blocks cross-event contest APIs (scoreboard leak)", () => {
    expect(isExamForbiddenApiRequest("/api/contests/c1/scoreboard", "GET")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/contests/c1/scoreboard/chart", "GET")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/contests/c1", "POST")).toBe(true);
  });

  it("blocks post APIs (covert channel during exams)", () => {
    expect(isExamForbiddenApiRequest("/api/posts/p1", "GET")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/posts/p1/comments", "POST")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/posts/p1/votes", "POST")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/posts/p1/reports", "POST")).toBe(true);
  });

  it("blocks comment APIs (covert channel during exams)", () => {
    expect(isExamForbiddenApiRequest("/api/comments/c1", "DELETE")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/comments/c1/reports", "POST")).toBe(true);
  });

  it("blocks the per-problem posts API without touching other problems APIs", () => {
    expect(isExamForbiddenApiRequest("/api/problems/prob-1/posts", "GET")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/problems/prob-1/posts/extra", "GET")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/problems/prob-1", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/problems/prob-1/bundle", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/problems/prob-1/workspace/files", "GET")).toBe(
      false,
    );
    expect(isExamForbiddenApiRequest("/api/problems/prob-1/posts-lookalike", "GET")).toBe(
      false,
    );
    expect(isExamForbiddenApiRequest("/api/problems/advanced-scaffold", "POST")).toBe(false);
  });

  it("allows the /api endpoints the exam UI legitimately uses", () => {
    expect(isExamForbiddenApiRequest("/api/submissions", "POST")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/submissions/s1", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/problems/p1", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/events/stream", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/clarifications", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/exam-sessions/exam-1/release", "POST")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/notifications", "GET")).toBe(false);
  });

  it("does not match non-/api paths that merely contain 'contests' or 'posts'", () => {
    expect(isExamForbiddenApiRequest("/contests/c1/scoreboard", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/problems/p1/posts", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/posts/p1", "GET")).toBe(false);
  });
});

describe("resolveExamGateDenial", () => {
  it("allows when the verdict is ok", () => {
    expect(resolveExamGateDenial({ ok: true }, "/api/submissions")).toBeNull();
    expect(resolveExamGateDenial({ ok: true }, "/exams/exam-1")).toBeNull();
  });

  it("blocks IP failures on every surface (page + api)", () => {
    for (const reason of ["ip_whitelist", "ip_binding"] as const) {
      expect(resolveExamGateDenial({ ok: false, reason }, "/api/submissions")).toEqual({
        scope: "all",
        status: 403,
        code: "exam_ip_blocked",
      });
      expect(resolveExamGateDenial({ ok: false, reason }, "/exams/exam-1")).toEqual({
        scope: "all",
        status: 403,
        code: "exam_ip_blocked",
      });
    }
  });

  it("blocks authorization failures on /api only, leaving pages to the exam shell", () => {
    for (const reason of [
      "not_enrolled",
      "course_archived",
      "not_published",
      "not_found",
    ] as const) {
      expect(resolveExamGateDenial({ ok: false, reason }, "/api/clarifications")).toEqual({
        scope: "api",
        status: 403,
        code: `exam_${reason}`,
      });
      expect(resolveExamGateDenial({ ok: false, reason }, "/exams/exam-1")).toBeNull();
    }
  });

  it("does NOT block ended / not_started (auto-close + submit gate own those)", () => {
    for (const reason of ["ended", "not_started"] as const) {
      expect(resolveExamGateDenial({ ok: false, reason }, "/api/submissions")).toBeNull();
      expect(resolveExamGateDenial({ ok: false, reason }, "/exams/exam-1")).toBeNull();
    }
  });
});
