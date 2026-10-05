// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import EditorActionBar from "$lib/components/features/problem/editors/EditorActionBar.svelte";
import { m } from "$lib/paraglide/messages.js";

describe("EditorActionBar submit cooldown", () => {
  it("disables submit, counts down and explains the wait", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(EditorActionBar, {
      target,
      props: {
        isRunning: false,
        isSubmitting: false,
        hasSubmittableSource: true,
        availableLanguageCount: 1,
        cooldownUntil: Date.now() + 30_000,
        onRun: vi.fn(),
        onSubmit: vi.fn(),
      },
    });
    await tick();

    const submit = [...target.querySelectorAll("button")].find((button) =>
      button.textContent.includes(m.editor_submitCooldown({ seconds: 30 })),
    );
    expect(submit?.disabled).toBe(true);
    expect(submit?.title).toBe(m.editor_submitCooldownTooltip());

    await unmount(component);
    target.remove();
  });
});
