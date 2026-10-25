import { describe, expect, it } from "vitest";

import { svelteKitConfig } from "../../../apps/web/vite.config.js";

describe("web content security policy", () => {
  it("allows WebAssembly without enabling JavaScript eval", () => {
    const scriptSources = svelteKitConfig.csp?.directives?.["script-src"];

    expect(scriptSources).toContain("wasm-unsafe-eval");
    expect(scriptSources).not.toContain("unsafe-eval");
  });

  it("allows only the external image host used by the about page", () => {
    const imageSources = svelteKitConfig.csp?.directives?.["img-src"];

    expect(imageSources).toContain("https://avatars.githubusercontent.com");
    expect(imageSources).not.toContain("https://*.googleusercontent.com");
    expect(imageSources).not.toContain("https:");
    expect(imageSources).not.toContain("https://github.com");
  });
});
