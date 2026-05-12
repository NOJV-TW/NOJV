/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDraftKey,
  clearDraft,
  inferDraftContext,
  loadDraft,
  saveDraft,
  type DraftKey,
} from "$lib/stores/code-draft";

const PROBLEM_ID = "prob_123";
const LANGUAGE = "python";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("buildDraftKey", () => {
  it("formats practice key", () => {
    expect(
      buildDraftKey({
        context: { kind: "practice" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    ).toBe("nojv:draft:v1:practice:prob_123:python");
  });

  it("formats exam key with examId", () => {
    expect(
      buildDraftKey({
        context: { kind: "exam", examId: "exam_1" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    ).toBe("nojv:draft:v1:exam:exam_1:prob_123:python");
  });

  it("formats assignment key with assessmentId", () => {
    expect(
      buildDraftKey({
        context: { kind: "assignment", assessmentId: "as_1" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    ).toBe("nojv:draft:v1:assignment:as_1:prob_123:python");
  });

  it("formats contest key with contestId", () => {
    expect(
      buildDraftKey({
        context: { kind: "contest", contestId: "ct_1" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    ).toBe("nojv:draft:v1:contest:ct_1:prob_123:python");
  });
});

describe("saveDraft / loadDraft", () => {
  const key: DraftKey = {
    context: { kind: "practice" },
    problemId: PROBLEM_ID,
    language: LANGUAGE,
  };

  it("round-trips code and savedAt", () => {
    const record = saveDraft(key, "print('hi')");
    const loaded = loadDraft(key);
    expect(loaded).toEqual(record);
    expect(loaded?.code).toBe("print('hi')");
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("returns null for missing key", () => {
    expect(loadDraft(key)).toBeNull();
  });

  it("returns null when storage value is not JSON", () => {
    localStorage.setItem(buildDraftKey(key), "not-json-{");
    expect(() => loadDraft(key)).not.toThrow();
    expect(loadDraft(key)).toBeNull();
  });

  it("returns null when JSON shape is wrong (zod rejects)", () => {
    localStorage.setItem(buildDraftKey(key), JSON.stringify({ code: 123 }));
    expect(loadDraft(key)).toBeNull();
  });

  it("clearDraft removes the entry", () => {
    saveDraft(key, "x = 1");
    clearDraft(key);
    expect(loadDraft(key)).toBeNull();
  });
});

describe("saveDraft quota fallback", () => {
  it("evicts oldest draft and retries on QuotaExceededError", () => {
    // Seed: two existing drafts with known savedAt values.
    const oldKey = "nojv:draft:v1:practice:old_problem:python";
    const newerKey = "nojv:draft:v1:practice:newer_problem:python";
    localStorage.setItem(oldKey, JSON.stringify({ code: "old", savedAt: 1000 }));
    localStorage.setItem(newerKey, JSON.stringify({ code: "newer", savedAt: 5000 }));

    const target: DraftKey = {
      context: { kind: "practice" },
      problemId: "target_problem",
      language: "python",
    };

    const realSetItem = Storage.prototype.setItem;
    let throws = 1;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (throws > 0 && k === buildDraftKey(target)) {
        throws--;
        const err = new DOMException("quota", "QuotaExceededError");
        throw err;
      }
      realSetItem.call(this, k, v);
    });

    saveDraft(target, "fresh");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(oldKey)).toBeNull();
    expect(localStorage.getItem(newerKey)).not.toBeNull();
    expect(loadDraft(target)?.code).toBe("fresh");
  });
});

describe("inferDraftContext", () => {
  it("maps exam route", () => {
    expect(
      inferDraftContext("/(app)/exams/[examId]/problems/[problemId]", {
        examId: "e1",
        problemId: "p1",
      }),
    ).toEqual({ kind: "exam", examId: "e1" });
  });

  it("maps assignment route", () => {
    expect(
      inferDraftContext("/(app)/assignments/[assignmentId]/problems/[problemId]", {
        assignmentId: "a1",
        problemId: "p1",
      }),
    ).toEqual({ kind: "assignment", assessmentId: "a1" });
  });

  it("maps contest route", () => {
    expect(
      inferDraftContext("/(app)/contests/[contestId]/problems/[problemId]", {
        contestId: "c1",
        problemId: "p1",
      }),
    ).toEqual({ kind: "contest", contestId: "c1" });
  });

  it("maps practice route", () => {
    expect(inferDraftContext("/(app)/problems/[problemId]", { problemId: "p1" })).toEqual({
      kind: "practice",
    });
  });

  it("falls back to practice for unknown route", () => {
    expect(inferDraftContext("/some/other/route", {})).toEqual({ kind: "practice" });
  });

  it("falls back to practice when null route id", () => {
    expect(inferDraftContext(null, {})).toEqual({ kind: "practice" });
  });

  it("falls back to practice when exam route is missing examId param", () => {
    expect(
      inferDraftContext("/(app)/exams/[examId]/problems/[problemId]", {
        problemId: "p1",
      }),
    ).toEqual({ kind: "practice" });
  });
});
