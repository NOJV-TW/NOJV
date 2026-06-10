import { describe, expect, it } from "vitest";

import {
  acquireSseSlot,
  releaseSseSlot,
} from "../../../apps/web/src/lib/server/shared/sse-slot";

describe("sse-slot — per-user and global connection caps", () => {
  it("allows up to the per-user cap then rejects, and frees on release", () => {
    const user = `usr_${String(Math.random())}`;

    const grants = Array.from({ length: 5 }, () => acquireSseSlot("events", user));
    expect(grants.every(Boolean)).toBe(true);

    expect(acquireSseSlot("events", user)).toBe(false);

    releaseSseSlot("events", user);
    expect(acquireSseSlot("events", user)).toBe(true);

    for (let i = 0; i < 5; i++) releaseSseSlot("events", user);
  });

  it("a released slot does not leak — acquire/release round-trips to full capacity", () => {
    const user = `usr_${String(Math.random())}`;

    for (let cycle = 0; cycle < 20; cycle++) {
      expect(acquireSseSlot("events", user)).toBe(true);
      releaseSseSlot("events", user);
    }
    const grants = Array.from({ length: 5 }, () => acquireSseSlot("events", user));
    expect(grants.every(Boolean)).toBe(true);

    for (let i = 0; i < 5; i++) releaseSseSlot("events", user);
  });

  it("over-releasing never drives capacity below zero", () => {
    const user = `usr_${String(Math.random())}`;

    releaseSseSlot("events", user);
    releaseSseSlot("events", user);

    const grants = Array.from({ length: 5 }, () => acquireSseSlot("events", user));
    expect(grants.every(Boolean)).toBe(true);

    for (let i = 0; i < 5; i++) releaseSseSlot("events", user);
  });
});
