import { describe, expect, it } from "vitest";

import { GET } from "../../../apps/web/src/routes/docs/+server";

describe("API docs theme integration", () => {
  it("serves the shared theme bridge and light card overrides", async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('const siteThemeKey = "nojv-theme"');
    expect(html).toContain('const scalarThemeKey = "colorMode"');
    expect(html).toContain("body.light-mode .scalar-app .dark-mode");
    expect(html).toContain("--scalar-background-2: #f6f6f6");
  });
});
