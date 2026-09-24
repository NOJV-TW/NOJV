// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { m } from "$lib/paraglide/messages.js";

vi.mock("@lucide/svelte", async () => ({
  Copy: (await import("../../fixtures/web/empty-component.svelte")).default,
  Check: (await import("../../fixtures/web/empty-component.svelte")).default,
  RotateCcw: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/rotate-ccw", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/CodeBlock.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/submission/SubtaskResultTree.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/submission/CaseResultGrid.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/services/http", () => ({ fetchWithCsrf: vi.fn() }));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: vi.fn(), success: vi.fn() } }));

describe("SubmissionHistoryPanel", () => {
  let component: ReturnType<typeof mount> | undefined;
  let target: HTMLDivElement | undefined;

  let intersect: (() => void) | undefined;
  beforeEach(() => {
    intersect = undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          intersect = () => callback([{ isIntersecting: true }]);
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(async () => {
    if (component) await unmount(component);
    target?.remove();
    vi.unstubAllGlobals();
  });

  it("moves the score into the summary row and displays memory", async () => {
    const { default: SubmissionHistoryPanel } =
      await import("$lib/components/features/problem/left-panel/SubmissionHistoryPanel.svelte");
    target = document.createElement("div");
    document.body.append(target);
    component = mount(SubmissionHistoryPanel, {
      target,
      props: {
        submissions: [
          {
            id: "submission-1",
            language: "cpp",
            status: "wrong_answer",
            judgeGeneration: 1,
            updatedAt: "2026-09-21T00:00:00Z",
            submittedAt: "2026-08-20T08:00:00.000Z",
            sourceCode: "int main() {}",
            result: {
              accepted: false,
              caseResults: [],
              feedback: "Wrong answer",
              memoryKb: 26_316,
              runtimeMs: 170,
              score: 0,
              subtaskResults: [],
              verdict: "wrong_answer",
            },
          },
        ],
        total: 101,
        viewingId: "submission-1",
      },
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const copy = target.querySelector<HTMLButtonElement>('[aria-label="Copy submission ID"]')!;
    copy.click();
    await vi.waitFor(() => expect(copy.getAttribute("aria-label")).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith("submission-1");

    expect(target.textContent).not.toContain(m.submissionDetail_finalScoreLabel());
    expect(target.textContent).toContain(`${m.submissionDetail_runtime()}: 170 ms`);
    expect(target.textContent).toContain(`${m.submissionDetail_memory()}: 25.7 MB`);
    expect(target.querySelector('[data-testid="submission-score"]')?.textContent).toContain(
      "0/101",
    );

    target.querySelector<HTMLButtonElement>("button")!.click();
    await tick();
    expect(target.querySelector("[data-submission-id]")).toBeNull();
    expect(target.querySelector('[aria-label="Copy submission ID"]')).toBeNull();
    target.querySelector<HTMLButtonElement>("button")!.click();
    await tick();
    expect(
      target.querySelector("[data-submission-id]")?.getAttribute("data-submission-id"),
    ).toBe("submission-1");
    expect(target.querySelector('[aria-label="Copy submission ID"]')).not.toBeNull();
  });
  it("automatically loads beyond 150 rows and retries without discarding earlier pages", async () => {
    const { default: SubmissionHistoryPanel } =
      await import("$lib/components/features/problem/left-panel/SubmissionHistoryPanel.svelte");
    const entries = Array.from({ length: 151 }, (_, index) => ({
      id: `submission_${index}`,
      language: "python",
      status: "accepted" as const,
      judgeGeneration: 1,
      updatedAt: "2026-09-21T00:00:00Z",
      submittedAt: new Date(1800000000000 - index).toISOString(),
      result: {
        accepted: true,
        verdict: "accepted" as const,
        score: 100,
        runtimeMs: 1,
        feedback: "Accepted",
      },
    }));
    const fetchMock = vi.fn(async (url: string) => {
      const query = new URL(url, "https://example.test").searchParams;
      expect(query.get("problemId")).toBe("problem_a");
      expect(JSON.parse(query.get("workspaceContext")!)).toEqual({
        type: "exam",
        examId: "exam_1",
      });
      const offset = entries.findIndex((entry) => entry.id === query.get("cursor")) + 1;
      const items = entries.slice(offset, offset + 50);
      return new Response(
        JSON.stringify({
          items,
          nextCursor: offset + 50 < entries.length ? items.at(-1)!.id : null,
        }),
      );
    });
    fetchMock.mockRejectedValueOnce(new Error("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    target = document.createElement("div");
    document.body.append(target);
    component = mount(SubmissionHistoryPanel, {
      target,
      props: {
        submissions: entries.slice(0, 50),
        problemId: "problem_a",
        context: { type: "exam", examId: "exam_1" },
      },
    });
    await tick();
    intersect!();
    await vi.waitFor(() => expect(target!.textContent).toContain(m.common_retry()));
    expect(target.querySelectorAll("button")).toHaveLength(51);
    for (const count of [100, 150, 151]) {
      if (count === 100) {
        [...target.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.trim() === m.common_retry())!
          .click();
      } else intersect!();
      await vi.waitFor(() => {
        expect(target!.querySelectorAll("button")).toHaveLength(count + (count < 151 ? 1 : 0));
        if (count === 151)
          expect(target!.textContent).not.toContain(m.admin_submissions_next());
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(target.textContent).not.toContain(m.admin_submissions_next());
  });
  it("reloads hydrated details after a server refresh replaces them with a summary", async () => {
    const { default: Harness } = await import("./fixtures/submission-history-harness.svelte");
    const summary = {
      accepted: false,
      verdict: "wrong_answer" as const,
      score: 0,
      runtimeMs: 170,
      feedback: "Wrong answer",
    };
    const entry = {
      id: "submission_1",
      language: "cpp",
      status: "wrong_answer" as const,
      judgeGeneration: 1,
      updatedAt: "2026-09-21T00:00:00Z",
      sourceCode: "int main() {}",
      submittedAt: "2026-09-21T00:00:00Z",
      result: { ...summary, memoryKb: 26316, caseResults: [] },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          submissionId: entry.id,
          problemId: "a",
          problemTitle: "A",
          judgeGeneration: entry.judgeGeneration,
          updatedAt: entry.updatedAt,
          result: entry.result,
          status: "wrong_answer",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    target = document.createElement("div");
    document.body.append(target);
    const harness = mount(Harness, { target, props: { initial: [entry] } });
    component = harness;
    await tick();
    expect(target.textContent).toContain("25.7 MB");
    harness.refresh([{ ...entry, result: summary }]);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(target!.textContent).toContain("25.7 MB");
    });
  });
  it("renders a terminal error without a result object instead of a pending spinner", async () => {
    const { default: Panel } =
      await import("$lib/components/features/problem/left-panel/SubmissionHistoryPanel.svelte");
    target = document.createElement("div");
    document.body.append(target);
    component = mount(Panel, {
      target,
      props: {
        submissions: [
          {
            id: "error_1",
            language: "python",
            status: "system_error",
            judgeGeneration: 2,
            updatedAt: "2026-09-21T00:00:00.000Z",
            submittedAt: "2026-09-21T00:00:00.000Z",
          },
        ],
        viewingId: "error_1",
      },
    });
    await tick();
    expect(target.textContent).not.toContain(m.submission_pending());
    expect(target.querySelector(".animate-spin")).toBeNull();
    expect(target.textContent).toContain(m.submissions_loadFailed());
  });
});
