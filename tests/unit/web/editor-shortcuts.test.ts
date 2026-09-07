// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProblemDetail } from "$lib/types";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  submit: vi.fn(),
  run: { isSubmitting: false, panelRunCases: [], markDestroyed: vi.fn() },
}));
vi.mock("$lib/services/browser-local-run", () => ({ shouldUseBrowserLocalRun: () => false }));
vi.mock("$lib/components/features/problem/editors/use-draft.svelte", () => ({
  createDraftController: () => ({
    save: mocks.save,
    hydrate: vi.fn(),
    scheduleAutosave: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock("$lib/components/features/problem/editors/use-editor-run.svelte", () => ({
  createEditorRunController: () => ({ ...mocks.run, submit: mocks.submit }),
}));
vi.mock("$lib/components/features/problem/editors/EditorCore.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorBottomPanel.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/StudentProblemView.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorTopBar.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorActionBar.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/editors/EditorResizeHandle.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/ConfirmDialog.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
import Editor from "$lib/components/features/problem/editors/Editor.svelte";

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
  vi.clearAllMocks();
  mocks.run.isSubmitting = false;
});

async function render(type: ProblemDetail["type"] = "full_source", code = "int main() {}") {
  target = document.createElement("div");
  document.body.append(target);
  component = mount(Editor, {
    target,
    props: {
      problem: {
        id: "problem_1",
        type,
        starterByLanguage: { cpp: code },
        workspaceFiles: [],
        samples: [],
        judgeType: "classic",
        judgeConfig: {},
        timeLimitMs: 1000,
        memoryLimitMb: 256,
      } as unknown as ProblemDetail,
      context: { type: "practice" },
      draftContext: { kind: "practice" },
    },
  });
  await tick();
}

function press(key: string, modifier: "ctrlKey" | "metaKey" = "ctrlKey", shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key,
    [modifier]: true,
    shiftKey,
    cancelable: true,
    bubbles: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe("editor shortcuts", () => {
  it.each(["ctrlKey", "metaKey"] as const)(
    "saves and submits with %s, and removes listeners on unmount",
    async (modifier) => {
      await render();
      expect(press("s", modifier).defaultPrevented).toBe(true);
      expect(mocks.save).toHaveBeenCalledOnce();
      expect(press("Enter", modifier).defaultPrevented).toBe(true);
      expect(mocks.submit).toHaveBeenCalledOnce();
      expect(press("Enter", modifier, true).defaultPrevented).toBe(false);
      await unmount(component!);
      component = undefined;
      press("Enter", modifier);
      expect(mocks.submit).toHaveBeenCalledOnce();
    },
  );

  it("does not intercept workspace save", async () => {
    await render("multi_file");
    expect(press("s").defaultPrevented).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("keeps the busy and empty-source guards", async () => {
    mocks.run.isSubmitting = true;
    await render();
    press("Enter");
    expect(mocks.submit).not.toHaveBeenCalled();
    await unmount(component!);
    target.remove();
    mocks.run.isSubmitting = false;
    await render("full_source", " ");
    press("Enter");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
