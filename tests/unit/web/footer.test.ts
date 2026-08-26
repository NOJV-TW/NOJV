// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lucide/svelte/icons/mail", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

describe("Footer", () => {
  it("places the verdict explanation next to the environment link", async () => {
    const { default: Footer } = await import("$lib/components/primitives/layout/Footer.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(Footer, { target });

    const links = Array.from(target.querySelectorAll("nav a"), (link) =>
      link.getAttribute("href"),
    );
    expect(links.indexOf("/verdicts")).toBe(links.indexOf("/environment") + 1);

    await unmount(component);
    target.remove();
  });
});
