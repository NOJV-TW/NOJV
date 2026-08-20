// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import HighlightedCode from "$lib/components/primitives/ui/HighlightedCode.svelte";

describe("HighlightedCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders syntax colors without WebAssembly support", async () => {
    vi.stubGlobal("WebAssembly", undefined);
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(HighlightedCode, {
      target,
      props: { code: "def main():\n    return 42", language: "python" },
    });

    await vi.waitFor(
      () => {
        const colors = Array.from(target.querySelectorAll<HTMLElement>(".tok"))
          .map((token) => token.style.getPropertyValue("--sd"))
          .filter(Boolean);
        expect(new Set(colors).size).toBeGreaterThan(1);
      },
      { timeout: 10_000 },
    );

    await unmount(component);
    target.remove();
  });
});
