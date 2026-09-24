// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import ToggleSwitch from "$lib/components/primitives/ui/ToggleSwitch.svelte";

describe("ToggleSwitch", () => {
  it("exposes a native label, switch semantics, description, and checkbox behavior", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const description = document.createElement("p");
    description.id = "privacy-description";
    description.textContent = "Anyone can view the profile.";
    target.append(description);
    const component = mount(ToggleSwitch, {
      target,
      props: {
        id: "privacy-toggle",
        label: "Public profile",
        descriptionId: description.id,
      },
    });

    const input = target.querySelector<HTMLInputElement>("#privacy-toggle");
    const label = target.querySelector<HTMLLabelElement>('label[for="privacy-toggle"]');
    expect(input?.getAttribute("role")).toBe("switch");
    expect(input?.getAttribute("aria-describedby")).toBe(description.id);
    expect(label?.textContent).toContain("Public profile");
    expect(input?.checked).toBe(false);

    input?.click();
    await tick();
    expect(input?.checked).toBe(true);
    const accessibility = await axe.run(target, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);

    await unmount(component);
    target.remove();
  });
});
