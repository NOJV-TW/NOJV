import { afterEach, describe, expect, it, vi } from "vitest";

let mockedLocale = "en";

vi.mock("$lib/paraglide/runtime.js", () => ({
  getLocale: () => mockedLocale,
}));

vi.mock("$lib/paraglide/messages.js", () => ({
  // The datetime module imports `m` at the top for unrelated helpers
  // (weekday + countdown). Stub the keys actually referenced.
  m: {
    weekday_short_0: () => "Sun",
    weekday_short_1: () => "Mon",
    weekday_short_2: () => "Tue",
    weekday_short_3: () => "Wed",
    weekday_short_4: () => "Thu",
    weekday_short_5: () => "Fri",
    weekday_short_6: () => "Sat",
    countdown_past: () => "passed",
    countdown_remaining: () => "remaining",
  },
}));

import {
  formatDate,
  formatDateTime,
  formatTime,
} from "../../../apps/web/src/lib/utils/datetime";

afterEach(() => {
  mockedLocale = "en";
});

describe("formatDateTime", () => {
  it("uses the active Paraglide locale", () => {
    const value = new Date("2026-05-20T10:30:00Z");
    mockedLocale = "en";
    const enOut = formatDateTime(value);
    mockedLocale = "zh-TW";
    const zhOut = formatDateTime(value);
    expect(enOut).not.toBe(zhOut);
    // zh-TW format uses CJK locale-specific characters/separators that
    // never appear in the default en short format.
    expect(zhOut).toMatch(/2026/);
    expect(enOut).toMatch(/2026/);
  });

  it("appends a timezone short name by default", () => {
    const value = new Date("2026-05-20T10:30:00Z");
    const out = formatDateTime(value);
    // Either `GMT`, `UTC`, or an explicit offset like `+08:00` — depends
    // on the host TZ. All three include one of these substrings.
    expect(out).toMatch(/GMT|UTC|[+-]\d/);
  });

  it("lets caller options override defaults", () => {
    const value = new Date("2026-05-20T10:30:00Z");
    const out = formatDateTime(value, { timeZoneName: undefined, year: undefined });
    // With both fields dropped the output should contain neither a 4-digit
    // year nor a timezone abbreviation.
    expect(out).not.toMatch(/2026/);
  });

  it("returns empty string on invalid input", () => {
    expect(formatDateTime("not-a-date")).toBe("");
    expect(formatDateTime(Number.NaN)).toBe("");
  });
});

describe("formatDate", () => {
  it("omits the timezone marker", () => {
    const value = new Date("2026-05-20T10:30:00Z");
    const out = formatDate(value);
    expect(out).not.toMatch(/GMT|UTC/);
  });
});

describe("formatTime", () => {
  it("renders time-of-day in the active locale", () => {
    const value = new Date("2026-05-20T10:30:00Z");
    const out = formatTime(value);
    // The formatted string should contain a colon-separated time portion.
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });
});
