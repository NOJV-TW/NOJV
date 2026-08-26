// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { Calendar: Empty, Megaphone: Empty, Pin: Empty };
});

vi.mock("$app/state", () => ({
  page: { data: { user: { id: "user-1" } } },
}));

vi.mock("$lib/components/features/announcement/AnnouncementViewDialog.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

describe("home page layout", () => {
  it("keeps the announcements card at its content height", async () => {
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
          ],
        },
      },
    });

    const cards = target.querySelectorAll('[data-slot="card"]');
    expect(cards[0]?.parentElement?.classList.contains("items-start")).toBe(true);
    expect(cards[0]?.querySelector("h2")?.nextElementSibling?.classList.contains("mt-0")).toBe(
      true,
    );
    expect(cards[1]?.querySelector("h2")?.nextElementSibling?.classList.contains("mt-0")).toBe(
      true,
    );

    await unmount(component);
    target.remove();
  });
});
