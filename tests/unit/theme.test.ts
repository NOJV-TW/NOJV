/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import {
  isThemeMode,
  persistThemeMode,
  readThemeMode,
  resolveIsDark,
  toggleThemeMode,
} from "$lib/stores/theme";

beforeEach(() => {
  localStorage.clear();
});

describe("isThemeMode", () => {
  it("accepts the three valid modes", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isThemeMode("blue")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

describe("readThemeMode", () => {
  it("defaults to system when nothing stored", () => {
    expect(readThemeMode()).toBe("system");
  });

  it("returns a stored valid mode", () => {
    localStorage.setItem("nojv-theme", "dark");
    expect(readThemeMode()).toBe("dark");
  });

  it("defaults to system for an invalid stored value", () => {
    localStorage.setItem("nojv-theme", "neon");
    expect(readThemeMode()).toBe("system");
  });
});

describe("persistThemeMode", () => {
  it("round-trips through readThemeMode", () => {
    persistThemeMode("light");
    expect(readThemeMode()).toBe("light");
  });
});

describe("resolveIsDark", () => {
  it("follows the system preference in system mode", () => {
    expect(resolveIsDark("system", true)).toBe(true);
    expect(resolveIsDark("system", false)).toBe(false);
  });

  it("ignores the system preference for explicit modes", () => {
    expect(resolveIsDark("dark", false)).toBe(true);
    expect(resolveIsDark("light", true)).toBe(false);
  });
});

describe("toggleThemeMode", () => {
  it("starts from the opposite of the system-resolved theme", () => {
    expect(toggleThemeMode("system", false)).toBe("dark");
    expect(toggleThemeMode("system", true)).toBe("light");
  });

  it("only toggles between explicit light and dark modes", () => {
    expect(toggleThemeMode("light", false)).toBe("dark");
    expect(toggleThemeMode("dark", true)).toBe("light");
  });
});
