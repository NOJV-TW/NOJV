import { mount, unmount } from "svelte";
import { expect, it, vi } from "vitest";

vi.mock("@lucide/svelte", async () => ({
  ArrowDown: (await import("../../fixtures/web/arrow-down-icon.svelte")).default,
  ArrowUp: (await import("../../fixtures/web/arrow-up-icon.svelte")).default,
  ArrowUpDown: (await import("../../fixtures/web/arrow-up-down-icon.svelte")).default,
}));

import TableSortButton from "$lib/components/primitives/ui/TableSortButton.svelte";

it.each([
  { direction: null, icon: "up-down" },
  { direction: "asc", icon: "up" },
  { direction: "desc", icon: "down" },
] as const)("renders the $direction state and reports clicks", async ({ direction, icon }) => {
  const target = document.createElement("div");
  document.body.append(target);
  const onclick = vi.fn();
  const component = mount(TableSortButton, {
    target,
    props: { label: "Joined", direction, onclick },
  });

  const button = target.querySelector("button");
  expect(button?.textContent?.trim()).toBe("Joined");
  expect(target.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe(icon);

  button?.click();
  expect(onclick).toHaveBeenCalledOnce();

  await unmount(component);
  target.remove();
});
