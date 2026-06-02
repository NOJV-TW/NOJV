/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  clampPanelWidth,
  persistPanelWidth,
  readPanelWidth,
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
