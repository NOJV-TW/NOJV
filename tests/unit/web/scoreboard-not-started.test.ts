import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contestNotStarted } from "$lib/utils/scoreboard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.resolve(__dirname, "../../../apps/web/messages");
const readMessages = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(messagesDir, `${locale}.json`), "utf8"));

const en = readMessages("en");
const zh = readMessages("zh-TW");

describe("contestNotStarted", () => {
  const now = new Date("2050-06-01T00:00:00Z");

  it("is true when the start time is in the future", () => {
    expect(contestNotStarted("2050-06-01T00:00:01Z", now)).toBe(true);
    expect(contestNotStarted(new Date("2099-01-01T00:00:00Z"), now)).toBe(true);
  });

  it("is false once the start time has passed", () => {
    expect(contestNotStarted("2050-05-31T23:59:59Z", now)).toBe(false);
    expect(contestNotStarted(new Date("2020-01-01T00:00:00Z"), now)).toBe(false);
  });

  it("is false at the exact start instant (start counts as started)", () => {
    expect(contestNotStarted("2050-06-01T00:00:00Z", now)).toBe(false);
    expect(contestNotStarted(new Date(now), now)).toBe(false);
  });
});

describe("scoreboard not-started i18n", () => {
  it("exposes the not-started hint in both locales", () => {
    expect(en.contestScoreboard_notStartedHint).toBeTruthy();
    expect(zh.contestScoreboard_notStartedHint).toBeTruthy();
  });

  it("keeps en and zh-TW key sets in parity", () => {
    const enKeys = Object.keys(en).filter((k) => k !== "$schema");
    const zhKeys = Object.keys(zh).filter((k) => k !== "$schema");
    expect(new Set(zhKeys)).toEqual(new Set(enKeys));
  });

  it("drops the unused title/startsAt keys from the toast-only flow", () => {
    for (const messages of [en, zh]) {
      expect("contestScoreboard_notStartedTitle" in messages).toBe(false);
      expect("contestScoreboard_startsAtLabel" in messages).toBe(false);
    }
  });

  it("unifies the Chinese naming on 計分榜 (no 計分板 / 排行榜)", () => {
    expect(JSON.stringify(zh)).not.toMatch(/計分板|排行榜/);
  });
});
