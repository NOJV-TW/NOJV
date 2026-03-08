import { describe, expect, it } from "vitest";

import { resolveWebAppOrigin } from "./runtime-config";

describe("resolveWebAppOrigin", () => {
  it("uses VITE_NOJV_WEB_ORIGIN when present", () => {
    expect(
      resolveWebAppOrigin({
        VITE_NOJV_WEB_ORIGIN: "https://web.nojv.dev/"
      })
    ).toBe("https://web.nojv.dev");
  });

  it("falls back to the local web origin when the env var is absent", () => {
    expect(resolveWebAppOrigin({})).toBe("http://localhost:3000");
  });
});
