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
const OWNER = { userId: "user_1", cipherKey: Buffer.alloc(32, 1).toString("base64") };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("buildDraftKey", () => {
  it("formats practice key", () => {
    expect(
      buildDraftKey({
        context: { ...OWNER, kind: "practice" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    ).toBe("nojv:draft:v2:user_1:practice:prob_123:python");
  });

  it("formats exam key with examId", () => {
    expect(
      buildDraftKey({
        context: { ...OWNER, kind: "exam", examId: "exam_1" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    ).toBe("nojv:draft:v2:user_1:exam:exam_1:prob_123:python");
  });

  it("formats assignment key with assignmentId", () => {
    expect(
      buildDraftKey({
        context: { ...OWNER, kind: "assignment", assignmentId: "as_1" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    ).toBe("nojv:draft:v2:user_1:assignment:as_1:prob_123:python");
  });

  it("formats contest key with contestId", () => {
    expect(
      buildDraftKey({
        context: { ...OWNER, kind: "contest", contestId: "ct_1" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    ).toBe("nojv:draft:v2:user_1:contest:ct_1:prob_123:python");
  });

  it("isolates virtual participation keys from practice and other participations", () => {
    const virtual = buildDraftKey({
      context: { ...OWNER, kind: "virtual", participationId: "vp_1" },
      problemId: PROBLEM_ID,
      language: LANGUAGE,
    });
    expect(virtual).toBe("nojv:draft:v2:user_1:virtual:vp_1:prob_123:python");
    expect(virtual).not.toBe(
      buildDraftKey({
        context: { ...OWNER, kind: "practice" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    );
    expect(virtual).not.toBe(
      buildDraftKey({
        context: { ...OWNER, kind: "virtual", participationId: "vp_2" },
        problemId: PROBLEM_ID,
        language: LANGUAGE,
      }),
    );
  });
});

describe("saveDraft / loadDraft", () => {
  const key: DraftKey = {
    context: { ...OWNER, kind: "practice" },
    problemId: PROBLEM_ID,
    language: LANGUAGE,
  };

  it("round-trips code and savedAt", async () => {
    const record = await saveDraft(key, "print('hi')");
    const loaded = await loadDraft(key);
    expect(loaded).toEqual(record);
    expect(loaded?.code).toBe("print('hi')");
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("never stores the code in plain text", async () => {
    await saveDraft(key, "print('secret answer')");
    expect(localStorage.getItem(buildDraftKey(key))).not.toContain("secret answer");
  });

  it("returns null for missing key", async () => {
    expect(await loadDraft(key)).toBeNull();
  });

  it("returns null when storage value is not JSON", async () => {
    localStorage.setItem(buildDraftKey(key), "not-json-{");
    expect(await loadDraft(key)).toBeNull();
  });

  it("returns null for a legacy plain-text record", async () => {
    localStorage.setItem(buildDraftKey(key), JSON.stringify({ code: "x", savedAt: 1 }));
    expect(await loadDraft(key)).toBeNull();
  });

  it("does not load another user's draft for the same problem", async () => {
    await saveDraft(key, "print('mine')");
    expect(
      await loadDraft({ ...key, context: { ...key.context, userId: "user_2" } }),
    ).toBeNull();
  });

  it("cannot decrypt a copied draft without the owner's key", async () => {
    await saveDraft(key, "print('mine')");
    const other = {
      ...key,
      context: { ...key.context, cipherKey: Buffer.alloc(32, 2).toString("base64") },
    };
    expect(await loadDraft(other)).toBeNull();
  });

  it("rejects a draft moved to a different problem key", async () => {
    await saveDraft(key, "print('mine')");
    const moved = { ...key, problemId: "prob_other" };
    localStorage.setItem(buildDraftKey(moved), localStorage.getItem(buildDraftKey(key))!);
    expect(await loadDraft(moved)).toBeNull();
  });

  it("moves a legacy plain-text practice draft into encrypted storage", async () => {
    localStorage.setItem(
      "nojv:draft:v1:practice:prob_123:python",
      JSON.stringify({ code: "print('old')", savedAt: 1 }),
    );
    expect((await loadDraft(key))?.code).toBe("print('old')");
    expect(localStorage.getItem("nojv:draft:v1:practice:prob_123:python")).toBeNull();
    expect(localStorage.getItem(buildDraftKey(key))).not.toContain("print('old')");
    expect((await loadDraft(key))?.code).toBe("print('old')");
  });

  it("leaves legacy exam drafts untouched instead of handing them to whoever signs in", async () => {
    const legacy = JSON.stringify({ code: "answer", savedAt: 1 });
    localStorage.setItem("nojv:draft:v1:exam:e1:prob_123:python", legacy);
    const examKey: DraftKey = { ...key, context: { ...OWNER, kind: "exam", examId: "e1" } };
    expect(await loadDraft(examKey)).toBeNull();
    expect(localStorage.getItem("nojv:draft:v1:exam:e1:prob_123:python")).toBe(legacy);
  });

  it("clearDraft removes the entry", async () => {
    await saveDraft(key, "x = 1");
    clearDraft(key);
    expect(await loadDraft(key)).toBeNull();
  });
});

describe("saveDraft quota fallback", () => {
  it("evicts oldest draft and retries on QuotaExceededError", async () => {
    const oldKey = "nojv:draft:v2:user_1:practice:old_problem:python";
    const newerKey = "nojv:draft:v2:user_1:practice:newer_problem:python";
    localStorage.setItem(oldKey, JSON.stringify({ savedAt: 1000, iv: "", data: "" }));
    localStorage.setItem(newerKey, JSON.stringify({ savedAt: 5000, iv: "", data: "" }));

    const target: DraftKey = {
      context: { ...OWNER, kind: "practice" },
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

    await saveDraft(target, "fresh");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(oldKey)).toBeNull();
    expect(localStorage.getItem(newerKey)).not.toBeNull();
    expect((await loadDraft(target))?.code).toBe("fresh");
  });
});

describe("draftContextFromSubmissionContext", () => {
  it.each([
    [{ type: "practice" } as const, { ...OWNER, kind: "practice" }],
    [{ type: "exam", examId: "e1" } as const, { ...OWNER, kind: "exam", examId: "e1" }],
    [
      { type: "assignment", assessmentId: "a1", courseId: "course_1" } as const,
      { ...OWNER, kind: "assignment", assignmentId: "a1" },
    ],
    [
      { type: "contest", contestId: "c1" } as const,
      { ...OWNER, kind: "contest", contestId: "c1" },
    ],
    [
      { type: "virtual", participationId: "vp1" } as const,
      { ...OWNER, kind: "virtual", participationId: "vp1" },
    ],
  ])("maps canonical submission context %o", (context, expected) => {
    expect(draftContextFromSubmissionContext(context, OWNER)).toEqual(expected);
  });
});
