import { describe, expect, it } from "vitest";

import {
  assertApiTokenRuleAccess,
  findApiTokenRouteRule,
  listApiTokenRouteRules,
} from "@nojv/application";

describe("API token ACL route whitelist", () => {
  it("matches dynamic allowlisted submission routes", () => {
    const rule = findApiTokenRouteRule("GET", "/api/submissions/sub_123/source");

    expect(rule?.path).toBe("/api/submissions/{id}/source");
    expect(rule?.params).toEqual({ id: "sub_123" });
    expect(rule?.requiredScope).toBe("submissions:read");
  });

  it("does not allow token auth on undocumented internal routes by default", () => {
    expect(findApiTokenRouteRule("POST", "/api/notifications")).toBeNull();
    expect(findApiTokenRouteRule("GET", "/api/admin/users")).toBeNull();
  });

  it("enforces required scopes", () => {
    const rule = findApiTokenRouteRule("POST", "/api/submissions");
    expect(rule).not.toBeNull();

    expect(() =>
      assertApiTokenRuleAccess({
        actorRole: "student",
        rule: rule!,
        scopes: ["submissions:write"],
      }),
    ).not.toThrow();

    expect(() =>
      assertApiTokenRuleAccess({
        actorRole: "student",
        rule: rule!,
        scopes: ["submissions:read"],
      }),
    ).toThrow("Insufficient API token scope.");
  });

  it("supports internal admin-only token routes without opening all internal docs", () => {
    const rule = findApiTokenRouteRule("GET", "/api/admin/healthz");
    expect(rule?.visibility).toBe("internal");
    expect(rule?.requiredScope).toBe("admin:read");

    expect(() =>
      assertApiTokenRuleAccess({
        actorRole: "admin",
        rule: rule!,
        scopes: ["admin:read"],
      }),
    ).not.toThrow();

    expect(() =>
      assertApiTokenRuleAccess({
        actorRole: "teacher",
        rule: rule!,
        scopes: ["admin:read"],
      }),
    ).toThrow("Insufficient platform role.");
  });

  it("keeps public and internal visibility explicit", () => {
    expect(listApiTokenRouteRules().map((rule) => rule.visibility)).toContain("public");
    expect(listApiTokenRouteRules().map((rule) => rule.visibility)).toContain("internal");
  });
});
