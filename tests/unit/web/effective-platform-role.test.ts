import { describe, expect, it } from "vitest";

import { resolveEffectivePlatformRole } from "$lib/server/auth";

describe("resolveEffectivePlatformRole", () => {
  it("keeps a de-elevated admin at student until they toggle admin mode", () => {
    expect(resolveEffectivePlatformRole("admin", false)).toBe("student");
  });

  it("elevates an admin to admin only while admin mode is active", () => {
    expect(resolveEffectivePlatformRole("admin", true)).toBe("admin");
  });

  it("never changes teacher or student, regardless of the toggle", () => {
    expect(resolveEffectivePlatformRole("teacher", false)).toBe("teacher");
    expect(resolveEffectivePlatformRole("teacher", true)).toBe("teacher");
    expect(resolveEffectivePlatformRole("student", false)).toBe("student");
    expect(resolveEffectivePlatformRole("student", true)).toBe("student");
  });
});
