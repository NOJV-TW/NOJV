// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { ProblemDetail } from "$lib/types";
import { m } from "$lib/paraglide/messages.js";

type Progress = { loadedBytes: number; totalBytes: number };

const mocks = vi.hoisted(() => ({
  preload:
    vi.fn<(language: string, onProgress: (progress: Progress) => void) => Promise<void>>(),
  prewarm: vi.fn(),
  run: {
    isSubmitting: false,
    panelRunCases: [],
    testDisabledReason: null,
    markDestroyed: vi.fn(),
  },
}));
vi.mock("$lib/services/browser-local-run", () => ({
  supportsBrowserLocalRun: () => true,
  prewarmBrowserLocalEngine: mocks.prewarm,
  preloadBrowserToolchain: mocks.preload,
  browserToolchainPercent: ({ loadedBytes, totalBytes }: Progress) =>
    Math.floor((loadedBytes / totalBytes) * 100),
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
  createEditorRunController: () => ({ ...mocks.run, submit: vi.fn(), run: vi.fn() }),
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
vi.mock("$lib/components/features/problem/editors/EditorTopBar.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorResizeHandle.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/ConfirmDialog.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
import Editor from "$lib/components/features/problem/editors/Editor.svelte";
import EditorActionBar from "$lib/components/features/problem/editors/EditorActionBar.svelte";

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
  vi.clearAllMocks();
});

it("preloads the editor language's toolchain and shows its progress on Test", async () => {
  let finishDownload!: () => void;
  mocks.prewarm.mockResolvedValue(undefined);
  mocks.preload.mockImplementation(
    (_language, onProgress) =>
      new Promise<void>((resolve) => {
        onProgress({ loadedBytes: 30, totalBytes: 100 });
        finishDownload = resolve;
      }),
  );
  target = document.createElement("div");
  document.body.append(target);
  component = mount(Editor, {
    target,
    props: {
      problem: {
        id: "problem_1",
        type: "full_source",
        starterByLanguage: { cpp: "int main() {}" },
        workspaceFiles: [],
        samples: [],
        judgeType: "standard",
        judgeConfig: {},
        timeLimitMs: 1000,
        memoryLimitMb: 256,
      } as unknown as ProblemDetail,
      context: { type: "practice" },
      draftContext: { userId: "user_1", cipherKey: "", kind: "practice" },
    },
  });
  const testButton = () => target.querySelector("button");

  await vi.waitFor(() =>
    expect(mocks.preload).toHaveBeenCalledWith("cpp", expect.any(Function)),
  );
  await tick();
  expect(mocks.prewarm).toHaveBeenCalledOnce();
  expect(testButton()?.textContent).toContain(m.editor_toolchainDownloading({ percent: 30 }));

  finishDownload();
  await vi.waitFor(() => expect(testButton()?.textContent).toContain(m.editor_run()));
});

it("keeps Test clickable while the toolchain downloads", async () => {
  const onRun = vi.fn();
  target = document.createElement("div");
  document.body.append(target);
  component = mount(EditorActionBar, {
    target,
    props: {
      isRunning: false,
      isSubmitting: false,
      hasSubmittableSource: true,
      availableLanguageCount: 1,
      toolchainPercent: 42,
      onRun,
      onSubmit: vi.fn(),
    },
  });
  await tick();

  const test = target.querySelector("button");
  expect(test?.textContent).toContain(m.editor_toolchainDownloading({ percent: 42 }));
  expect(test?.disabled).toBe(false);
  expect(test?.getAttribute("aria-busy")).toBe("true");
  test?.click();
  expect(onRun).toHaveBeenCalledOnce();
});
