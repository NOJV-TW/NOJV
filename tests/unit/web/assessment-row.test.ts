// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return {
    Calendar: Empty,
    CalendarCheck2: Empty,
    CalendarClock: Empty,
    ChevronRight: Empty,
    Radio: Empty,
  };
});

describe("AssessmentRow", () => {
  it("keeps the status available to assistive technology when its icon is hidden", async () => {
    const { default: AssessmentRow } =
      await import("$lib/components/features/coursework/AssessmentRow.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(AssessmentRow, {
      target,
      props: {
        href: "/assignments/a1",
        kind: "assignment",
        typeLabel: "Assignment",
        title: "Homework 1",
        status: "closed",
        showStatusIcon: false,
      },
    });

    expect(target.querySelector(".sr-only")?.textContent?.trim()).toBe(
      m.statusPill_assignment_closed(),
    );

    await unmount(component);
    target.remove();
  });
});
