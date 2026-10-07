// @vitest-environment jsdom

import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supportedLanguages, type Language } from "@nojv/core";

import { m } from "$lib/paraglide/messages.js";

vi.mock("$lib/components/primitives/ui/MonacoScriptEditor.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));

const { default: WorkspaceSection } =
  await import("$lib/components/features/problem/sections/WorkspaceSection.svelte");

type Snapshot = {
  runtime: { timeLimitMs: number; memoryLimitMb: number; env: Record<string, string> };
  type: "multi_file";
  files: {
    language: Language;
    path: string;
    content: string;
    description: string;
    visibility: "editable" | "readonly";
    orderIndex: number;
  }[];
};
type SavedPayload = Snapshot & { allowedLanguages: Language[] };

const runtime = { timeLimitMs: 1000, memoryLimitMb: 256, env: {} };
const file = (language: Language, path: string, description = "") => ({
  language,
  path,
  content: `// ${path}`,
  description,
  visibility: "editable" as const,
  orderIndex: 0,
});

let target: HTMLDivElement;
let component: { save: () => void } | undefined;
const onsave = vi.fn<(payload: SavedPayload) => Promise<void>>();
const ondirtychange = vi.fn<(dirty: boolean) => void>();

beforeEach(() => {
  vi.clearAllMocks();
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
});

function render(initial: Snapshot) {
  component = mount(WorkspaceSection, {
    target,
    props: { initial, onsave, ondirtychange },
  }) as {
    save: () => void;
  };
  flushSync();
}

function languageCheckbox(lang: Language): HTMLInputElement {
  const boxes = target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  return boxes[supportedLanguages.indexOf(lang)]!;
}

async function save(): Promise<SavedPayload> {
  const calls = onsave.mock.calls.length;
  component!.save();
  await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(calls + 1));
  return onsave.mock.calls[calls]![0];
}

describe("WorkspaceSection", () => {
  it("ticks exactly the languages that ship an editable entry file", () => {
    render({
      runtime,
      type: "multi_file",
      files: [file("python", "main.py"), file("cpp", "main.cpp"), file("go", "helper.go")],
    });

    expect(languageCheckbox("python").checked).toBe(true);
    expect(languageCheckbox("cpp").checked).toBe(true);
    expect(languageCheckbox("go").checked).toBe(false);
    expect(languageCheckbox("c").checked).toBe(false);
  });

  it("saves descriptions and drops the files of unticked languages", async () => {
    onsave.mockResolvedValue(undefined);
    render({
      runtime,
      type: "multi_file",
      files: [file("python", "main.py", "Implement solve()."), file("cpp", "main.cpp")],
    });

    languageCheckbox("cpp").click();
    flushSync();
    const payload = await save();

    expect(payload.allowedLanguages).toEqual(["python"]);
    expect(payload.files).toEqual([
      expect.objectContaining({ path: "main.py", description: "Implement solve()." }),
    ]);
  });

  it("adds an uploaded file to the editor so the next save keeps it", async () => {
    onsave.mockResolvedValue(undefined);
    render({ runtime, type: "multi_file", files: [file("python", "main.py")] });

    const input = target.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File(["print(2)\n"], "helper.py")],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(target.textContent).toContain("helper.py"));
    const payload = await save();

    expect(payload.files.map((f) => f.path)).toEqual(["main.py", "helper.py"]);
    expect(payload.files[1]).toMatchObject({ language: "python", content: "print(2)\n" });
  });

  it("treats the saved state as persisted, so dropped files stay gone", async () => {
    onsave.mockResolvedValue(undefined);
    render({
      runtime,
      type: "multi_file",
      files: [file("python", "main.py"), file("cpp", "main.cpp")],
    });

    languageCheckbox("cpp").click();
    flushSync();
    expect(ondirtychange).toHaveBeenLastCalledWith(true);
    await save();
    await vi.waitFor(() => expect(target.textContent).toContain(m.admin_saved()));

    expect(ondirtychange).toHaveBeenLastCalledWith(false);
    languageCheckbox("cpp").click();
    flushSync();
    expect(target.textContent).toContain(
      m.admin_workspaceMissingTemplatesBanner({ languages: "cpp" }),
    );
  });
});
