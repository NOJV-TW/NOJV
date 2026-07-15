/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDraftKey,
  clearDraft,
  draftContextFromSubmissionContext,
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

  it("formats assignment key with assignmentId", () => {
    expect(
      buildDraftKey({
        context: { kind: "assignment", assignmentId: "as_1" },
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

  it("isolates virtual participation keys from practice and other participations", () => {
    const virtual = buildDraftKey({
      context: { kind: "virtual", participationId: "vp_1" },
      problemId: PROBLEM_ID,
      language: LANGUAGE,
    });
    expect(virtual).toBe("nojv:draft:v1:virtual:vp_1:prob_123:python");
    expect(virtual).not.toBe(
      buildDraftKey({
        context: { kind: "practice" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    );
    expect(virtual).not.toBe(
      buildDraftKey({
        context: { kind: "virtual", participationId: "vp_2" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    );
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

describe("draftContextFromSubmissionContext", () => {
  it.each([
    [{ type: "practice" } as const, { kind: "practice" }],
    [{ type: "exam", examId: "e1" } as const, { kind: "exam", examId: "e1" }],
    [
      { type: "assignment", assessmentId: "a1", courseId: "course_1" } as const,
      { kind: "assignment", assignmentId: "a1" },
    ],
    [{ type: "contest", contestId: "c1" } as const, { kind: "contest", contestId: "c1" }],
    [
      { type: "virtual", participationId: "vp1" } as const,
      { kind: "virtual", participationId: "vp1" },
    ],
  ])("maps canonical submission context %o", (context, expected) => {
    expect(draftContextFromSubmissionContext(context)).toEqual(expected);
  });
});
