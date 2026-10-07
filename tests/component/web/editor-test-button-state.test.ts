// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Language } from "@nojv/core";
import type { ProblemDetail } from "$lib/types";
import { m } from "$lib/paraglide/messages.js";

type Prepared = import("$lib/services/judge-program").PreparedJudgeProgram;
type Progress = import("$lib/services/judge-program").JudgeProgramProgress;

const mocks = vi.hoisted(() => ({
  preload: vi.fn(() => Promise.resolve()),
  prepare:
    vi.fn<(scope: unknown, onProgress: (progress: Progress) => void) => Promise<Prepared>>(),
}));
vi.mock("$lib/services/browser-local-run", () => ({
  supportsBrowserLocalRun: () => true,
  prewarmBrowserLocalEngine: () => Promise.resolve(),
  preloadBrowserToolchain: mocks.preload,
  browserToolchainPercent: () => 0,
}));
vi.mock("$lib/services/judge-program", () => ({ prepareJudgeProgram: mocks.prepare }));
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
    markDestroyed: vi.fn(),
    setBottomTab: vi.fn(),
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
  vi.clearAllMocks();
});

async function renderTestButton(options: {
  type?: ProblemDetail["type"];
  judgeType?: ProblemDetail["judgeType"];
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
      } as unknown as ProblemDetail,
      initialLanguage: options.language ?? "cpp",
      context: { type: "practice" },
      draftContext: { userId: "user_1", cipherKey: "", kind: "practice" },
    },
  });
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const button = target.querySelector<HTMLButtonElement>(
    '[data-tour="problem-actions"] button',
  );
  if (!button) throw new Error("Test button not rendered");
  return button;
}

const checkerReady: Prepared = {
  ok: true,
  role: "checker",
  language: "python",
  artifact: {} as Extract<Prepared, { ok: true }>["artifact"],
};

function visibleReason(button: HTMLButtonElement): string | undefined {
  const id = button.getAttribute("aria-describedby");
  const caption = id ? document.getElementById(id) : null;
  if (!caption || caption.closest(".sr-only") || caption.hidden) return undefined;
  expect(caption.tagName).toBe("P");
  expect(caption.getAttribute("role")).toBe("status");
  expect(caption.className).not.toContain("sr-only");
  expect(button.parentElement?.contains(caption)).toBe(true);
  return caption.textContent.trim();
}

const interactiveSamples = [{ input: "", output: "", interactorInput: "1 100\n42\n" }];

describe("Test button state", () => {
  it("is disabled on special_env problems and explains why", async () => {
    const button = await renderTestButton({ type: "special_env" });
    expect(button.disabled).toBe(true);
    expect(visibleReason(button)).toBe(m.editor_testUnsupportedProblemType());
    expect(mocks.preload).not.toHaveBeenCalled();
  });

  it("says the checker is preparing and keeps Test clickable while it builds", async () => {
    mocks.prepare.mockImplementation((_scope, onProgress) => {
      onProgress({ phase: "build" });
      return new Promise<Prepared>(() => undefined);
    });
    const button = await renderTestButton({ judgeType: "checker" });
    await vi.waitFor(() => expect(button.textContent).toContain(m.editor_checkerPreparing()));
    expect(mocks.prepare).toHaveBeenCalledWith(
      {
        problemId: "problem_1",
        context: { type: "practice" },
        signal: expect.any(AbortSignal),
      },
      expect.any(Function),
    );
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(visibleReason(button)).toBeUndefined();
  });

  it("is enabled once the checker is built", async () => {
    mocks.prepare.mockResolvedValue(checkerReady);
    const button = await renderTestButton({ judgeType: "checker" });
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
    await tick();
    expect(button.textContent).toContain(m.editor_run());
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(visibleReason(button)).toBeUndefined();
  });

  it.each([
    [
      "fails to build",
      { ok: false, reason: "build_failed", diagnostics: "error" } as const,
      () => m.editor_checkerBuildFailed(),
    ],
    [
      "can't be loaded",
      { ok: false, reason: "load_failed" } as const,
      () => m.editor_checkerLoadFailed(),
    ],
    [
      "is refused",
      { ok: false, reason: "unavailable" } as const,
      () => m.editor_checkerUnavailable(),
    ],
  ])("is disabled when the checker %s", async (_label, prepared, reason) => {
    mocks.prepare.mockResolvedValue(prepared);
    const button = await renderTestButton({ judgeType: "checker" });
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    expect(visibleReason(button)).toBe(reason());
    expect(button.textContent).toContain(m.editor_run());
  });

  it("says the interactor is preparing and keeps Test clickable while it builds", async () => {
    mocks.prepare.mockImplementation((_scope, onProgress) => {
      onProgress({ phase: "build" });
      return new Promise<Prepared>(() => undefined);
    });
    const button = await renderTestButton({
      judgeType: "interactive",
      samples: interactiveSamples,
    });
    await vi.waitFor(() =>
      expect(button.textContent).toContain(m.editor_interactorPreparing()),
    );
    expect(mocks.preload).toHaveBeenCalledWith("cpp", expect.any(Function));
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(visibleReason(button)).toBeUndefined();
  });

  it("is enabled once the interactor is built", async () => {
    mocks.prepare.mockResolvedValue({ ...checkerReady, role: "interactor" });
    const button = await renderTestButton({
      judgeType: "interactive",
      samples: interactiveSamples,
    });
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
    await tick();
    expect(button.textContent).toContain(m.editor_run());
    expect(button.disabled).toBe(false);
    expect(visibleReason(button)).toBeUndefined();
  });

  it.each([
    [
      "fails to build",
      { ok: false, reason: "build_failed", diagnostics: "error" } as const,
      () => m.editor_interactorBuildFailed(),
    ],
    [
      "can't be loaded",
      { ok: false, reason: "load_failed" } as const,
      () => m.editor_interactorLoadFailed(),
    ],
    [
      "is refused",
      { ok: false, reason: "unavailable" } as const,
      () => m.editor_interactorUnavailable(),
    ],
  ])("is disabled when the interactor %s", async (_label, prepared, reason) => {
    mocks.prepare.mockResolvedValue(prepared);
    const button = await renderTestButton({
      judgeType: "interactive",
      samples: interactiveSamples,
    });
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    expect(visibleReason(button)).toBe(reason());
  });

  it("is enabled for an interactive problem without interactor samples", async () => {
    mocks.prepare.mockResolvedValue({ ...checkerReady, role: "interactor" });
    const button = await renderTestButton({
      judgeType: "interactive",
      samples: [{ input: "1", output: "1" }],
    });
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
    expect(button.disabled).toBe(false);
    expect(visibleReason(button)).toBeUndefined();
  });

  it("is disabled for an interactive problem in JavaScript without preparing anything", async () => {
    const button = await renderTestButton({
      judgeType: "interactive",
      language: "javascript",
      samples: interactiveSamples,
    });
    expect(button.disabled).toBe(true);
    expect(visibleReason(button)).toBe(m.editor_testInteractiveLanguage());
    expect(mocks.preload).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("is enabled on a standard problem and preloads the toolchain", async () => {
    const button = await renderTestButton({});
    expect(button.disabled).toBe(false);
    expect(visibleReason(button)).toBeUndefined();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    await vi.waitFor(() =>
      expect(mocks.preload).toHaveBeenCalledWith("cpp", expect.any(Function)),
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
