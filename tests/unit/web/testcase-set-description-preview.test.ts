// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import EmptyComponent from "./fixtures/empty-component.svelte";
import { m } from "$lib/paraglide/messages.js";

vi.mock("@lucide/svelte", () => ({
  Eye: EmptyComponent,
  ImagePlus: EmptyComponent,
  Pencil: EmptyComponent,
}));

describe("TestcaseSetEditForm", () => {
  it("previews the subtask description as rendered math", async () => {
    const { default: TestcaseSetEditForm } =
      await import("$lib/components/features/problem/testcase/TestcaseSetEditForm.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(TestcaseSetEditForm, {
      target,
      props: {
        editDescription: "保證 $R \\cdot C \\le 20$",
        editWeight: 20,
        problemId: "problem-1",
        saving: false,
        onSave: () => undefined,
        onCancel: () => undefined,
        onWeightChange: () => undefined,
      },
    });

    const textarea = target.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(target.querySelector(".katex-html")).toBeNull();

    const toggle = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${m.imageUpload_preview()}"]`,
    );
    expect(toggle).not.toBeNull();
    toggle?.click();
    await tick();

    expect(target.querySelector(".katex-html")).not.toBeNull();
    expect(target.textContent).toContain("保證");

    await unmount(component);
    target.remove();
  });
});
