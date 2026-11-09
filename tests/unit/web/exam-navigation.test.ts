import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeforeNavigate } from "$app/navigation";
import { recordExamNavigationAttempt } from "#lib/utils/exam-navigation.js";

afterEach(() => vi.unstubAllGlobals());

function navigation(routeId: string, shallow = false): BeforeNavigate {
  return {
    shallow,
    to: { route: { id: routeId }, params: { examId: "exam-1" } },
  } as BeforeNavigate;
}

describe("exam navigation audit", () => {
  it.each(["/(app)/exams/[examId]", "/(app)/exams/[examId]/problems/[problemId]"])(
    "records navigation to %s",
    (route) => {
      const request = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
      vi.stubGlobal("fetch", request);
      recordExamNavigationAttempt(navigation(route));
      expect(request).toHaveBeenCalledWith("/api/exams/exam-1/entry-attempt", {
        method: "POST",
        headers: { "x-requested-with": "fetch" },
      });
    },
  );
  it("ignores shallow changes and other routes", () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    recordExamNavigationAttempt(navigation("/(app)/exams/[examId]", true));
    recordExamNavigationAttempt(navigation("/(app)/dashboard"));
    expect(request).not.toHaveBeenCalled();
  });
  it("does not retry a failed audit request", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", request);
    recordExamNavigationAttempt(navigation("/(app)/exams/[examId]"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
