// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import WorkspaceTimer from "$lib/components/features/problem/layouts/WorkspaceTimer.svelte";

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock("$app/navigation", () => ({ goto: mocks.goto }));
vi.mock("@lucide/svelte", async () => ({
  X: (await import("./fixtures/empty-component.svelte")).default,
}));

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
const due = Date.parse("2030-01-01T01:00:00Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(due - 1000);
  vi.clearAllMocks();
  target = document.body.appendChild(document.createElement("div"));
});
afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
  vi.useRealTimers();
});

describe("WorkspaceTimer", () => {
  it.each(["exam", "assignment"] as const)(
    "switches %s from on-time to final countdown without expiring at due",
    async (type) => {
      component = mount(WorkspaceTimer, {
        target,
        props: {
          timer: {
            type,
            examId: "exam_1",
            dueAt: new Date(due).toISOString(),
            endsAt: new Date(due + 10_000).toISOString(),
            latePenalty: { type: "daily_late_penalty", perDayPct: 10 },
          },
        },
      });
      await tick();
      expect(target.textContent).toContain(m.lateSubmission_workspaceDueCountdown());
      expect(target.textContent).toContain("00:00:01");
      expect(target.textContent).toContain(m.lateSubmission_dailySummary({ pct: 10 }));
      await vi.advanceTimersByTimeAsync(1000);
      await tick();
      expect(mocks.goto).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      await tick();
      expect(target.textContent).toContain(m.lateSubmission_workspaceLateCountdown());
      expect(target.textContent).toContain("00:00:09");
      expect(mocks.goto).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(9000);
      await tick();
      expect(target.textContent).toContain(m.lateSubmission_workspaceClosed());
      if (type === "exam") expect(mocks.goto).toHaveBeenCalledExactlyOnceWith("/exams/exam_1");
      else expect(mocks.goto).not.toHaveBeenCalled();
    },
  );
});
