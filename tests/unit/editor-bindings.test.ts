/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  clampPanelWidth,
  createDocumentMouseDrag,
  persistPanelWidth,
  readPanelWidth,
  submissionContextBadge,
} from "$lib/components/features/problem/editors/editor-bindings";

const PANEL_WIDTH_KEY = "nojv:editor:panelWidth";

beforeEach(() => {
  localStorage.clear();
});

describe("clampPanelWidth", () => {
  it("keeps values within range", () => {
    expect(clampPanelWidth(50)).toBe(50);
  });

  it("clamps below the minimum", () => {
    expect(clampPanelWidth(5)).toBe(MIN_PANEL_WIDTH);
  });

  it("clamps above the maximum", () => {
    expect(clampPanelWidth(99)).toBe(MAX_PANEL_WIDTH);
  });
});

describe("readPanelWidth", () => {
  it("returns the default when nothing stored", () => {
    expect(readPanelWidth()).toBe(DEFAULT_PANEL_WIDTH);
  });

  it("returns a stored, in-range value", () => {
    localStorage.setItem(PANEL_WIDTH_KEY, "60");
    expect(readPanelWidth()).toBe(60);
  });

  it("clamps an out-of-range stored value", () => {
    localStorage.setItem(PANEL_WIDTH_KEY, "150");
    expect(readPanelWidth()).toBe(MAX_PANEL_WIDTH);
  });

  it("falls back to the default for a non-numeric value", () => {
    localStorage.setItem(PANEL_WIDTH_KEY, "wide");
    expect(readPanelWidth()).toBe(DEFAULT_PANEL_WIDTH);
  });
});

describe("persistPanelWidth", () => {
  it("round-trips through readPanelWidth", () => {
    persistPanelWidth(55);
    expect(readPanelWidth()).toBe(55);
  });

  it("stores a clamped value", () => {
    persistPanelWidth(3);
    expect(localStorage.getItem(PANEL_WIDTH_KEY)).toBe(String(MIN_PANEL_WIDTH));
  });
});

describe("createDocumentMouseDrag", () => {
  it("restores body state and removes document listeners when disposed mid-drag", () => {
    document.body.style.cursor = "wait";
    document.body.style.userSelect = "text";
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const drag = createDocumentMouseDrag({
      cursor: "col-resize",
      onStart: vi.fn(),
      onMove,
      onEnd,
    });

    drag.start(new MouseEvent("mousedown"));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10 }));
    expect(onMove).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe("col-resize");

    drag.dispose();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20 }));
    expect(onMove).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe("wait");
    expect(document.body.style.userSelect).toBe("text");
  });
});

describe("submissionContextBadge", () => {
  it.each([
    [{ type: "practice" } as const, null],
    [{ type: "exam", examId: "exam_1" } as const, null],
    [
      { type: "assignment", assessmentId: "assignment_1", courseId: "course_1" } as const,
      "assignment",
    ],
    [{ type: "contest", contestId: "contest_1" } as const, "contest"],
    [{ type: "virtual", participationId: "virtual_1" } as const, "contest"],
  ])("derives display state from canonical context %o", (context, expected) => {
    expect(submissionContextBadge(context)).toBe(expected);
  });
});
