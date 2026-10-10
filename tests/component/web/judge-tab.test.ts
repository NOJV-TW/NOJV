// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { JudgeType } from "@nojv/core";
import type { ProblemDetail } from "$lib/types";

import { m } from "$lib/paraglide/messages.js";

vi.mock("$lib/utils/actions", () => ({ submitFormAction: vi.fn() }));
vi.mock("$lib/components/primitives/ui/MonacoScriptEditor.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));

const { default: JudgeTab } =
  await import("$lib/components/features/problem/tabs/JudgeTab.svelte");

let target: HTMLDivElement | undefined;
let component: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  if (component) await unmount(component);
  target?.remove();
  component = undefined;
  target = undefined;
});

async function render(type: JudgeType) {
  target = document.createElement("div");
  document.body.append(target);
  component = mount(JudgeTab, {
    target,
    props: {
      problem: { id: "problem_1", judgeConfig: { type } } as unknown as ProblemDetail,
      validatorScripts: { checkerScript: "", interactorScript: "" },
    },
  });
  await tick();
  return target;
}

it.each(["checker", "interactive"] as const)(
  "tells editors that students can read the %s program",
  async (type) => {
    const view = await render(type);

    expect(view.textContent).toContain(m.admin_judgeProgramReadableNote());
  },
);

it("shows no judge-program note on a standard problem", async () => {
  const view = await render("standard");

  expect(view.textContent).not.toContain(m.admin_judgeProgramReadableNote());
});
