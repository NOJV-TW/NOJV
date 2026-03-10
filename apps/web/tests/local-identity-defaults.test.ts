import { describe, expect, it } from "vitest";

import {
  createLocalDisplayName,
  createLocalEmail,
  sanitizeIdentitySegment
} from "../src/lib/server/data-access/shared";

describe("sanitizeIdentitySegment", () => {
  it("falls back to a neutral local identifier", () => {
    expect(sanitizeIdentitySegment("!!!")).toBe("local-user");
  });
});

describe("local identity defaults", () => {
  it("uses the local runtime email domain instead of historical bootstrap naming", () => {
    expect(createLocalEmail("USR Demo Editor")).toBe("usr-demo-editor@local.nojv.dev");
  });

  it("uses a neutral local display name", () => {
    expect(createLocalDisplayName("usr_demo_editor")).toBe("Local usr demo editor");
  });
});
