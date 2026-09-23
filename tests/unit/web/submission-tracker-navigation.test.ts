// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invalidate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("$app/navigation", () => ({ invalidate: mocks.invalidate, invalidateAll: vi.fn() }));

import { navigating } from "$app/state";
import {
  onSubmissionRefresh,
  requestSubmissionRefresh,
  stopSubmissionTracking,
} from "$lib/services/submission-tracker";

const pendingNavigation = navigating as { to: unknown };

afterEach(() => {
  pendingNavigation.to = null;
  stopSubmissionTracking();
  vi.useRealTimers();
});

it("waits for an in-flight navigation instead of invalidating the page it is leaving", async () => {
  vi.useFakeTimers();
  const stop = onSubmissionRefresh(() => Promise.resolve());
  pendingNavigation.to = { url: new URL("http://localhost/exams/e1") };

  requestSubmissionRefresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.invalidate).not.toHaveBeenCalled();

  pendingNavigation.to = null;
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.invalidate).toHaveBeenCalledWith("submission:data");
  stop();
});
