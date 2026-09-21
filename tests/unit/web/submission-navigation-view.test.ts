import {
  stopSubmissionTracking,
  requestSubmissionRefresh,
} from "$lib/services/submission-tracker";
import { mount, tick, unmount } from "svelte";
import { expect, it, vi } from "vitest";
import type { ProblemSubmissionEntry } from "$lib/types";
import { m } from "$lib/paraglide/messages.js";
import Harness from "./fixtures/submission-navigation-harness.svelte";

const mocks = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock("$app/forms", () => ({ enhance: vi.fn() }));
vi.mock("$lib/components/primitives/ui/CodeBlock.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/layouts/WorkspaceTimer.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$app/navigation", () => ({ invalidateAll: mocks.refresh, invalidate: mocks.refresh }));
vi.mock("$lib/services/browser-local-run", () => ({}));
vi.mock("$lib/stores/sse", () => ({ watchSubmissionVerdict: () => () => undefined }));
vi.mock("$lib/stores/toast", () => ({
  toasts: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("$lib/components/features/problem/editors/Editor.svelte", async () => ({
  default: (await import("./fixtures/submission-editor.svelte")).default,
}));
vi.mock(
  "$lib/components/features/problem/left-panel/ProblemDescriptionPanel.svelte",
  async () => ({ default: (await import("./fixtures/empty-component.svelte")).default }),
);
vi.mock("$lib/components/features/problem/left-panel/PostPanel.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/layouts/MobileWorkspaceBlocker.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/advanced/AdvancedUploader.svelte", async () => ({
  default: (await import("./fixtures/submission-uploader.svelte")).default,
}));

it.each([false, true])(
  "updates A while B is selected and restores history (advanced=%s)",
  async (advanced) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    let submitted = false;
    let completed = false;
    const result = {
      accepted: true,
      verdict: "accepted" as const,
      score: 100,
      runtimeMs: 1,
      feedback: "Accepted",
      caseResults: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          submitted = true;
          return new Response(
            JSON.stringify({
              submissionId: "submission_a",
              pollUrl: "/api/submissions/submission_a",
              status: "queued",
            }),
            { status: 202 },
          );
        }
        if (url.endsWith("/source")) return new Response(JSON.stringify({ files: [] }));
        const operation = {
          submissionId: "submission_a",
          problemId: "a",
          problemTitle: "A",
          judgeGeneration: 1,
          updatedAt: "2026-09-21T00:00:01Z",
          status: completed ? "accepted" : "queued",
          result: completed ? result : null,
        };
        return new Response(
          JSON.stringify(
            url.includes("/status?") ? { items: [operation], unavailableIds: [] } : operation,
          ),
        );
      }),
    );
    const load = () => ({
      submissions: submitted
        ? [
            {
              id: "submission_a",
              language: "python",
              status: completed ? ("accepted" as const) : ("queued" as const),
              judgeGeneration: 1,
              updatedAt: "2026-09-21T00:00:01Z",
              submittedAt: "2026-09-21T00:00:00Z",
              ...(completed ? { result } : {}),
            } satisfies ProblemSubmissionEntry,
          ]
        : [],
      ...(completed ? { score: 100 } : {}),
    });
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(Harness, { target, props: { load, advanced } });
    mocks.refresh.mockImplementation(async () => {
      component.refresh();
    });
    try {
      await tick();
      if (advanced) {
        [...target.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent === "Stage upload")!
          .click();
        await tick();
        [...target.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.trim() === m.editor_submitButton())!
          .click();
      } else {
        [...target.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent === "Submit a")!
          .click();
      }
      await vi.waitFor(() => expect(submitted).toBe(true));
      component.navigate("b");
      await tick();
      expect(
        target.querySelector('a[title="B · Problem B"]')?.getAttribute("aria-current"),
      ).toBe("page");
      completed = true;
      requestSubmissionRefresh();
      await vi.waitFor(
        () =>
          expect(target.querySelector('a[title="A · Problem A"]')?.className).toContain(
            "bg-success",
          ),
        { timeout: 3000 },
      );
      expect(
        target.querySelector('a[title="B · Problem B"]')?.getAttribute("aria-current"),
      ).toBe("page");
      component.navigate("a");
      await tick();
      [...target.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((button) => button.textContent?.includes(m.problemDetail_submissions()))!
        .click();
      await tick();
      expect(target.textContent).toContain("AC");
      expect(target.textContent).toContain("100/100");
    } finally {
      await unmount(component);
      stopSubmissionTracking();
      target.remove();
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  },
);
