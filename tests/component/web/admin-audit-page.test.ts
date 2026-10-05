import { mount, unmount } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AuditPage from "../../../apps/web/src/routes/(app)/admin/audit/+page.svelte";

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock("$app/navigation", () => ({ goto: mocks.goto }));

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => mocks.goto.mockReset());
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function render(order: "asc" | "desc", nextCursor: string | null = "a50") {
  const target = document.createElement("div");
  document.body.append(target);
  const data = {
    order,
    nextCursor,
    entries: [
      {
        id: "a1",
        createdAt: new Date("2026-10-05T00:00:00Z"),
        actorName: "Admin",
        action: "user_disable",
        targetType: "user",
        summary: "Disabled a user",
      },
    ],
  };
  const component = mount(AuditPage, { target, props: { data: data as never } });
  cleanups.push(async () => {
    await unmount(component);
    target.remove();
  });
  return target;
}

it("flips the time order and restarts paging", () => {
  const target = render("desc");
  const header = target.querySelector("th[aria-sort]");
  expect(header?.getAttribute("aria-sort")).toBe("descending");
  expect(target.querySelector("a")?.getAttribute("href")).toBe("?cursor=a50");
  header?.querySelector("button")?.click();
  expect(mocks.goto).toHaveBeenCalledWith("/admin/audit?order=asc", {
    keepFocus: true,
    noScroll: true,
  });
});

it("keeps ascending order on the next page and returns to the default", () => {
  const target = render("asc");
  const header = target.querySelector("th[aria-sort]");
  expect(header?.getAttribute("aria-sort")).toBe("ascending");
  expect(target.querySelector("a")?.getAttribute("href")).toBe("?cursor=a50&order=asc");
  header?.querySelector("button")?.click();
  expect(mocks.goto).toHaveBeenCalledWith("/admin/audit", { keepFocus: true, noScroll: true });
});
