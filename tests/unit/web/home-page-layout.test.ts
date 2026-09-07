// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { Calendar: Empty, Megaphone: Empty, Pin: Empty };
});

vi.mock("$app/state", () => ({
  page: { data: { user: { id: "user-1" } }, url: new URL("http://localhost/") },
}));

vi.mock("$lib/components/features/announcement/AnnouncementViewDialog.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

describe("home page layout", () => {
  it("keeps desktop panels equal-height with independently scrollable lists", async () => {
    const { default: HomePage } =
      await import("../../../apps/web/src/routes/(public)/+page.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(HomePage, {
      target,
      props: {
        data: {
          announcements: [
            {
              id: "announcement-1",
              title: "System announcement",
              content: "Welcome to NOJV",
              pinned: false,
              published: true,
              createdAt: "2026-08-20T00:00:00.000Z",
              expiresAt: null,
              authorName: "NOJV",
            },
          ],
          assessments: [
            {
              id: "assessment-1",
              type: "assignment",
              title: "First assignment",
              courseTitle: "Operating Systems Lab",
              opensAt: "2026-08-20T00:00:00.000Z",
              dueAt: "2026-08-27T00:00:00.000Z",
              windowState: "open",
              windowStateColor: "",
            },
            {
              id: "assessment-2",
              type: "exam",
              title: "Midterm",
              courseTitle: "Operating Systems Lab",
              opensAt: "2026-09-20T00:00:00.000Z",
              dueAt: "2026-09-20T02:00:00.000Z",
              windowState: "upcoming",
              windowStateColor: "",
            },
          ],
        },
      },
    });

    const cards = target.querySelectorAll('[data-slot="card"]');
    expect(cards[0]?.parentElement?.classList.contains("items-stretch")).toBe(true);
    for (const card of cards) {
      expect(card.classList.contains("lg:h-[clamp(28rem,60svh,36rem)]")).toBe(true);
      const body = card.querySelector("h2")?.nextElementSibling;
      expect(body?.classList.contains("min-h-0")).toBe(true);
      expect(body?.classList.contains("flex-1")).toBe(true);
      expect(body?.classList.contains("lg:overflow-y-auto")).toBe(true);
      expect(body?.classList.contains("lg:-mb-4")).toBe(true);
      expect(body?.classList.contains("lg:pb-4")).toBe(true);
    }
    expect(
      Array.from(target.querySelectorAll("[data-assessment-group]"), (group) =>
        group.getAttribute("data-assessment-group"),
      ),
    ).toEqual(["active", "upcoming"]);

    await unmount(component);
    target.remove();
  });
});
