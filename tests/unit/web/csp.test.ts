import { describe, expect, it } from "vitest";

import config from "../../../apps/web/svelte.config.js";

describe("web content security policy", () => {
  it("does not allow eval-capable script sources", () => {
    const scriptSources = config.kit?.csp?.directives?.["script-src"];

    expect(scriptSources).not.toContain("unsafe-eval");
    expect(scriptSources).not.toContain("wasm-unsafe-eval");
  });

  it("allows only the external image hosts used by OAuth avatars and the about page", () => {
    const imageSources = config.kit?.csp?.directives?.["img-src"];

    expect(imageSources).toEqual(
      expect.arrayContaining([
        "https://github.com",
        "https://avatars.githubusercontent.com",
        "https://*.googleusercontent.com",
      ]),
    );
    expect(imageSources).not.toContain("https:");
  });
});
