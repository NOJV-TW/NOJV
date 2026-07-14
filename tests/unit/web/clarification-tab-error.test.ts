// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { expect, it, vi } from "vitest";

import { m } from "$lib/paraglide/messages.js";
import ClarificationTab from "$lib/components/features/clarification/ClarificationTab.svelte";

const mocks = vi.hoisted(() => ({
  init: vi.fn().mockRejectedValue(new Error("network unavailable")),
}));

vi.mock("$lib/stores/clarifications.svelte", () => ({
  createClarificationsStore: () => ({
    items: [],
    unreadCount: 0,
    init: mocks.init,
    handleSse: vi.fn(),
    markTabVisited: vi.fn(),
  }),
}));

vi.mock("$lib/stores/sse", () => ({
  onSSEEvent: () => vi.fn(),
  subscribeClarificationChannel: () => vi.fn(),
}));

vi.mock("$lib/components/features/clarification/ClarificationAskForm.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

vi.mock("$lib/components/features/clarification/ClarificationList.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

it("renders initial-load failures as an alert without an unhandled rejection", async () => {
  const target = document.createElement("div");
  const component = mount(ClarificationTab, {
    target,
    props: {
      contextType: "contest",
      contextId: "contest_1",
      canAsk: false,
      canAnswer: false,
      problems: [],
    },
  });

  try {
    await vi.waitFor(() => {
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(
        m.clarification_toastError(),
      );
    });
  } finally {
    await unmount(component);
  }
});
