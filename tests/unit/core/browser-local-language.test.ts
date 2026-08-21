import { describe, expect, it } from "vitest";

import { browserLocalLanguageSchema, isBrowserLocalLanguage } from "@nojv/core";

describe("browser local language capability", () => {
  it("matches the browser-local language set", () => {
    expect(browserLocalLanguageSchema.safeParse("cpp").success).toBe(true);
    expect(isBrowserLocalLanguage("typescript")).toBe(true);
    expect(isBrowserLocalLanguage("java")).toBe(true);
  });
});
