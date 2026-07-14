// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDraftAutosaveQueue, type DraftSnapshot } from "$lib/stores/draft-autosave";

function snapshot(language: string, code: string): DraftSnapshot {
  return {
    context: { kind: "practice" },
    problemId: "problem_1",
    language,
    code,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("draft autosave queue", () => {
  it("captures each language snapshot instead of reading mutable current state later", () => {
    vi.useFakeTimers();
    const persisted: DraftSnapshot[] = [];
    const queue = createDraftAutosaveQueue(1_200, (value) => persisted.push(value));

    queue.schedule(snapshot("cpp", "cpp draft"));
    queue.schedule(snapshot("python", "python draft"));
    vi.advanceTimersByTime(1_200);

    expect(persisted).toEqual([
      snapshot("cpp", "cpp draft"),
      snapshot("python", "python draft"),
    ]);
  });

  it("flushes every dirty language when the editor is disposed", () => {
    vi.useFakeTimers();
    const persisted: DraftSnapshot[] = [];
    const queue = createDraftAutosaveQueue(1_200, (value) => persisted.push(value));

    queue.schedule(snapshot("cpp", "cpp before leave"));
    queue.schedule(snapshot("python", "python before leave"));
    queue.flushAll();
    vi.runAllTimers();

    expect(persisted).toEqual([
      snapshot("cpp", "cpp before leave"),
      snapshot("python", "python before leave"),
    ]);
  });
});
