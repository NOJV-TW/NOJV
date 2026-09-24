import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it } from "vitest";
import { MAX_RUN_CASES } from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";
import Panel from "$lib/components/features/problem/editors/EditorBottomPanel.svelte";

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;
afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
});

it("keeps empty-answer comparison enabled and makes execution-only an explicit choice", async () => {
  target = document.createElement("div");
  document.body.append(target);
  component = mount(Panel, {
    target,
    props: {
      runCases: Array.from({ length: MAX_RUN_CASES }, () => ({
        input: "",
        expectedOutput: "",
      })),
      tab: "testcase",
      runResult: null,
      runStatus: null,
      runError: null,
      ontabchange: () => {},
    },
  });
  await tick();
  const checkbox = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const expected = target.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${m.editor_expectLabel()}"]`,
  )!;
  expect(checkbox.checked).toBe(true);
  expect(expected.disabled).toBe(false);
  expect(expected.value).toBe("");
  checkbox.click();
  await tick();
  expect(expected.disabled).toBe(true);
  checkbox.click();
  await tick();
  expect(expected.disabled).toBe(false);
  expect(expected.value).toBe("");
  expect(
    target.querySelector<HTMLButtonElement>(`button[aria-label="${m.editor_testcase()}"]`)!
      .disabled,
  ).toBe(true);
});
