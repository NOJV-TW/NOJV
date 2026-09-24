// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ from: null as { url: URL } | null }));
vi.mock("$app/navigation", () => ({
  afterNavigate: (callback: (event: { from: { url: URL } | null }) => void) =>
    callback({ from: navigation.from }),
}));
vi.mock("@lucide/svelte", async () => ({
  ArrowLeft: (await import("../../fixtures/web/empty-component.svelte")).default,
}));

import BackLink from "$lib/components/primitives/layout/BackLink.svelte";
import { m } from "$lib/paraglide/messages.js";

const cleanup: (() => Promise<void>)[] = [];

function render() {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(BackLink, {
    target,
    props: { href: "/exams/exam-1", label: "Back to exam" },
  });
  cleanup.push(async () => {
    await unmount(component);
    target.remove();
  });
  const anchor = target.querySelector("a")!;
  let prevented = false;
  target.addEventListener("click", (event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  });
  const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return { anchor, back, prevented: () => prevented };
}

afterEach(async () => {
  vi.restoreAllMocks();
  navigation.from = null;
  for (const fn of cleanup.splice(0)) await fn();
});

describe("BackLink", () => {
  it("follows the fallback href when the page was opened directly", () => {
    const { anchor, back, prevented } = render();
    expect(anchor.getAttribute("href")).toBe("/exams/exam-1");
    expect(anchor.textContent?.trim()).toBe("Back to exam");
    expect(back).not.toHaveBeenCalled();
    expect(prevented()).toBe(false);
  });

  it("goes back in history when the page was reached from inside the app", () => {
    navigation.from = { url: new URL("http://localhost/submissions") };
    const { anchor, back, prevented } = render();
    expect(anchor.textContent?.trim()).toBe(m.common_back());
    expect(back).toHaveBeenCalledOnce();
    expect(prevented()).toBe(true);
  });
});
