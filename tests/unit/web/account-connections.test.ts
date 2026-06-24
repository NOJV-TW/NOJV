import { describe, expect, it } from "vitest";

import {
  isLinkProvider,
  wouldOrphanAccount,
} from "$lib/server/account-connections";

describe("account-connections — provider guard", () => {
  it("recognizes linkable providers only", () => {
    expect(isLinkProvider("github")).toBe(true);
    expect(isLinkProvider("google")).toBe(true);
    expect(isLinkProvider("credential")).toBe(false);
    expect(isLinkProvider("twitter")).toBe(false);
  });
});

describe("account-connections — wouldOrphanAccount", () => {
  it("blocks unlinking the only login method", () => {
    expect(wouldOrphanAccount(["google"], "google")).toBe(true);
  });

  it("allows unlinking when another provider remains", () => {
    expect(wouldOrphanAccount(["google", "github"], "google")).toBe(false);
  });

  it("allows unlinking an OAuth provider when a password remains", () => {
    expect(wouldOrphanAccount(["google", "credential"], "google")).toBe(false);
  });

  it("ignores a provider that is not linked (no orphaning)", () => {
    expect(wouldOrphanAccount(["google"], "github")).toBe(false);
  });
});
