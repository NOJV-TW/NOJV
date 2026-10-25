// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { m } from "#lib/paraglide/messages.js";
import { syncServerClock } from "#lib/utils/datetime.js";
import ExamPage from "../../../apps/web/src/routes/(app)/exams/[examId]/+page.svelte";

vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return { AlertTriangle: Empty, ChevronRight: Empty, Monitor: Empty, Pencil: Empty, X: Empty };
});

const serverTime = Date.parse("2030-01-01T02:30:00Z");
const data = {
  detail: {
    id: "exam_1",
    title: "Quiz",
    summary: null,
    status: "published",
    startsAt: new Date(serverTime - 10 * 60_000).toISOString(),
    endsAt: new Date(serverTime + 90 * 60_000).toISOString(),
    dueAt: null,
    latePenalty: null,
    totalPoints: 100,
    viewerScore: null,
    gradingPending: false,
    pageLockEnabled: false,
    ipBindingEnabled: false,
    ipViolationMode: "notify",
    ipWhitelistEnabled: false,
    ipWhitelistCount: 0,
    submitIntervalSec: 0,
    manager: null,
    problems: [],
  },
  course: { archived: false },
  isManager: false,
  hasActiveSession: false,
  hasSubmitted: false,
  submittedProblemIds: [],
  feedback: [],
  matrix: null,
  canSetOverride: false,
  clarification: { canView: false, canAsk: false, canAnswer: false },
};

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  target = document.body.appendChild(document.createElement("div"));
});
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
  vi.useRealTimers();
});

it.each([8, -8])(
  "opens the start button on server time when the local clock is off by %i hours",
  async (skewHours) => {
    vi.setSystemTime(serverTime + skewHours * 3_600_000);
    syncServerClock(serverTime);
    component = mount(ExamPage, { target, props: { data: data as never, form: null } });
    await tick();
    const start = [...target.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === m.examDetail_studentStartButton(),
    );
    expect(start?.disabled).toBe(false);
    expect(target.textContent).toContain(m.examDetail_studentStartHintRunning());
  },
);
