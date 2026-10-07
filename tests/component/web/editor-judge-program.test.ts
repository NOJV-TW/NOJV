// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { ProblemDetail } from "$lib/types";
import { m } from "$lib/paraglide/messages.js";

type Prepared = import("$lib/services/judge-program").PreparedJudgeProgram;

const mocks = vi.hoisted(() => ({
  prepare: vi.fn<() => Promise<Prepared>>(),
  compile: vi.fn(),
  runCases: vi.fn(),
  check: vi.fn(),
}));
vi.mock("$lib/services/browser-local-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/browser-local-run")>()),
  prewarmBrowserLocalEngine: () => Promise.resolve(),
  preloadBrowserToolchain: () => Promise.resolve(),
  compileBrowserLocally: mocks.compile,
  runBrowserCases: mocks.runCases,
  runBrowserChecker: mocks.check,
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
vi.mock("$lib/components/features/problem/editors/EditorTopBar.svelte", async () => ({
  default: (await import("./fixtures/editor-top-bar-stub.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorCore.svelte", async () => ({
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

function mountCheckerEditor() {
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
        samples: [{ input: "1 2", output: "3" }],
        judgeType: "checker",
        judgeConfig: { type: "checker" },
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        interactionFormat: "",
      } as unknown as ProblemDetail,
      initialLanguage: "cpp",
      context: { type: "practice" },
      draftContext: { userId: "user_1", cipherKey: "", kind: "practice" },
    },
  });
}

function selectedTab() {
  return target.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim();
}

it("opens the Test Result tab with the checker's compiler output when it fails to build", async () => {
  mocks.prepare.mockResolvedValue({
    ok: false,
    reason: "build_failed",
    diagnostics: "main.cpp:2:1: error: expected ';'",
  });
  mountCheckerEditor();
  expect(selectedTab()).toBe(m.editor_testcase());

  await vi.waitFor(() =>
    expect(target.querySelector('[role="tabpanel"] pre')?.textContent).toBe(
      "main.cpp:2:1: error: expected ';'",
    ),
  );
  expect(selectedTab()).toBe(m.editor_testResult());
  expect(target.querySelector('[role="tabpanel"]')?.textContent).toContain(
    m.editor_checkerBuildFailed(),
  );
});

it("prepares the checker once across opening the editor and pressing Test", async () => {
  mocks.prepare.mockResolvedValue({
    ok: true,
    role: "checker",
    language: "python",
    artifact: {} as Extract<Prepared, { ok: true }>["artifact"],
  });
  mocks.compile.mockResolvedValue({ ok: true, artifact: { id: "solution" } });
  mocks.runCases.mockResolvedValue([
    { verdict: "AC", stdout: "3\n", timeMs: 1, exitCode: 0, termination: "exited" },
  ]);
  mocks.check.mockResolvedValue({ verdict: "AC", teamMessage: "Correct" });
  mountCheckerEditor();
  await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  await tick();

  target.querySelector<HTMLButtonElement>('[data-tour="problem-actions"] button')!.click();

  await vi.waitFor(() => expect(target.textContent).toContain("Correct"));
  expect(mocks.check).toHaveBeenCalledOnce();
  expect(mocks.prepare).toHaveBeenCalledOnce();
});
