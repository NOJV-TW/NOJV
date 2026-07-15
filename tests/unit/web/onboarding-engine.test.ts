// @vitest-environment jsdom

import type { DriveStep } from "driver.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getItem, removeItem, setItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  removeItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("$lib/paraglide/messages.js", () => ({
  m: {
    tour_done: () => "Done",
    tour_next: () => "Next",
    tour_prev: () => "Previous",
  },
}));

const { replayTour, startAutomaticTour } = await import("$lib/onboarding/engine");

const intro = {
  key: "welcome",
  pad: 2,
  match: (pathname: string) => pathname === "/dashboard",
  build: (): DriveStep[] => [{ element: "#tour-target", popover: { title: "Welcome" } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/dashboard");
  document.body.innerHTML = '<div id="tour-target">Target</div>';
  vi.stubGlobal("localStorage", { getItem, removeItem, setItem });
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
});

describe("onboarding tour engine", () => {
  it("starts an automatic tour only after the durable claim succeeds", async () => {
    await startAutomaticTour(intro, async () => false);
    expect(document.querySelector(".driver-popover")).toBeNull();

    await startAutomaticTour(intro, async () => true);
    expect(document.querySelector(".driver-popover")).not.toBeNull();
    document.querySelector<HTMLButtonElement>(".driver-popover-close-btn")?.click();
  });

  it("keeps explicit replay independent from browser persistence", () => {
    replayTour([intro]);

    expect(document.querySelector(".driver-popover")).not.toBeNull();
    expect(getItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>(".driver-popover-close-btn")?.click();
  });
});
