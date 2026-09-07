import { describe, expect, it } from "vitest";

import { navigating, page } from "../../setup/stubs/app-state";

describe("$app/state test stub", () => {
  it("provides the page and navigation fields used by the web app", () => {
    expect(page.url).toEqual(new URL("http://localhost/"));
    expect(page.params).toEqual({});
    expect(navigating).toMatchObject({ from: null, to: null, type: null });
  });
});
