// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Language, TestCapability } from "@nojv/core";
import type { ProblemDetail } from "$lib/types";
import { m } from "$lib/paraglide/messages.js";

const mocks = vi.hoisted(() => ({
  preload: vi.fn(() => Promise.resolve()),
  controllerReason: null as string | null,
}));
vi.mock("$lib/services/browser-local-run", () => ({
  supportsBrowserLocalRun: () => true,
  prewarmBrowserLocalEngine: () => Promise.resolve(),
  preloadBrowserToolchain: mocks.preload,
  browserToolchainPercent: () => 0,
}));
vi.mock("$lib/components/features/problem/editors/use-draft.svelte", () => ({
  createDraftController: () => ({
    save: vi.fn(),
    hydrate: vi.fn(),
    scheduleAutosave: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock("$lib/components/features/problem/editors/use-editor-run.svelte", () => ({
  createEditorRunController: () => ({
    isRunning: false,
    isSubmitting: false,
    panelRunCases: [],
    get testDisabledReason() {
      return mocks.controllerReason;
    },
    markDestroyed: vi.fn(),
    submit: vi.fn(),
    run: vi.fn(),
  }),
}));
vi.mock("$lib/components/features/problem/editors/EditorTopBar.svelte", async () => ({
  default: (await import("./fixtures/editor-top-bar-stub.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorCore.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorBottomPanel.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/StudentProblemView.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorResizeHandle.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/ConfirmDialog.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
import Editor from "$lib/components/features/problem/editors/Editor.svelte";

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
  mocks.controllerReason = null;
  vi.clearAllMocks();
});

async function renderTestButton(options: {
  type?: ProblemDetail["type"];
  judgeType?: ProblemDetail["judgeType"];
  testCapability?: TestCapability;
  language?: Language;
  samples?: ProblemDetail["samples"];
}) {
  target = document.createElement("div");
  document.body.append(target);
  component = mount(Editor, {
    target,
    props: {
      problem: {
        id: "problem_1",
        type: options.type ?? "full_source",
        starterByLanguage: { cpp: "int main() {}", javascript: "console.log(1);" },
        workspaceFiles: [],
        samples: options.samples ?? [],
        judgeType: options.judgeType ?? "standard",
        judgeConfig: {},
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        interactionFormat: "",
        testCapability: options.testCapability ?? { available: true },
      } as unknown as ProblemDetail,
      initialLanguage: options.language ?? "cpp",
      context: { type: "practice" },
      draftContext: { userId: "user_1", cipherKey: "", kind: "practice" },
    },
  });
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const button = [...target.querySelectorAll("button")].find((candidate) =>
    candidate.textContent.includes(m.editor_run()),
  );
  if (!button) throw new Error("Test button not rendered");
  return button;
}

function describedBy(button: HTMLButtonElement): string | undefined {
  const id = button.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? undefined) : undefined;
}

const interactiveSamples = [{ input: "", output: "", interactorInput: "1 100\n42\n" }];

describe("Test button state", () => {
  it("is disabled on special_env problems and explains why", async () => {
    const button = await renderTestButton({
      type: "special_env",
      testCapability: { available: false, reason: "special_env" },
    });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(m.editor_testUnsupportedProblemType());
    expect(describedBy(button)).toBe(m.editor_testUnsupportedProblemType());
    expect(mocks.preload).not.toHaveBeenCalled();
  });

  it.each(["test_judge_unavailable", "judge_program_unsupported"] as const)(
    "is disabled when the server reports %s",
    async (reason) => {
      const button = await renderTestButton({
        judgeType: "checker",
        testCapability: { available: false, reason },
      });
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(m.editor_testUnavailableForProblem());
      expect(describedBy(button)).toBe(m.editor_testUnavailableForProblem());
      expect(mocks.preload).not.toHaveBeenCalled();
    },
  );

  it("is disabled for an interactive problem in JavaScript", async () => {
    const button = await renderTestButton({
      judgeType: "interactive",
      language: "javascript",
      samples: interactiveSamples,
    });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(m.editor_testInteractiveLanguage());
    expect(describedBy(button)).toBe(m.editor_testInteractiveLanguage());
  });

  it("is disabled for an interactive problem without interactor samples", async () => {
    const button = await renderTestButton({
      judgeType: "interactive",
      samples: [{ input: "1", output: "1" }],
    });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(m.editor_testNoInteractiveSamples());
  });

  it("is enabled for an interactive problem in C++", async () => {
    const button = await renderTestButton({
      judgeType: "interactive",
      samples: interactiveSamples,
    });
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    await vi.waitFor(() =>
      expect(mocks.preload).toHaveBeenCalledWith("cpp", expect.any(Function)),
    );
  });

  it("is enabled on a standard problem and preloads the toolchain", async () => {
    const button = await renderTestButton({});
    expect(button.disabled).toBe(false);
    expect(button.title).toBe("");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    await vi.waitFor(() =>
      expect(mocks.preload).toHaveBeenCalledWith("cpp", expect.any(Function)),
    );
  });

  it("is disabled with the controller's reason after a judge program fails to build", async () => {
    mocks.controllerReason = m.editor_testJudgeProgramBuildFailed();
    const button = await renderTestButton({ judgeType: "checker" });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(m.editor_testJudgeProgramBuildFailed());
    expect(describedBy(button)).toBe(m.editor_testJudgeProgramBuildFailed());
    expect(mocks.preload).not.toHaveBeenCalled();
  });
});
