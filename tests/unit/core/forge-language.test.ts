import { describe, expect, it } from "vitest";

import { forgeLanguageSchema, isForgeLanguage } from "@nojv/core";

describe("Forge language capability", () => {
  it("matches Forge's published language set", () => {
    expect(forgeLanguageSchema.safeParse("cpp").success).toBe(true);
    expect(forgeLanguageSchema.safeParse("java").success).toBe(false);
    expect(isForgeLanguage("typescript")).toBe(true);
    expect(isForgeLanguage("java")).toBe(false);
  });
});
