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
    expect(findApiTokenRouteRule("DELETE", "/api/notifications")).toBeNull();
    expect(findApiTokenRouteRule("GET", "/api/admin/users")).toBeNull();
    expect(findApiTokenRouteRule("POST", "/api/problems/prob_1/bundle")).toBeNull();
  });

  it("allows read-only token routes for own data and scoreboards", () => {
    expect(findApiTokenRouteRule("GET", "/api/submissions")?.requiredScope).toBe(
      "submissions:read",
    );
    expect(findApiTokenRouteRule("GET", "/api/notifications")?.requiredScope).toBe(
      "profile:read",
    );
    expect(findApiTokenRouteRule("GET", "/api/notifications/unread-count")?.requiredScope).toBe(
      "profile:read",
    );
    expect(findApiTokenRouteRule("GET", "/api/problems/advanced-scaffold")?.requiredScope).toBe(
      "problems:read",
    );

    const scoreboard = findApiTokenRouteRule("GET", "/api/contests/contest_1/scoreboard");
    expect(scoreboard?.requiredScope).toBe("contests:read");
    expect(scoreboard?.params).toEqual({ id: "contest_1" });
    expect(
      findApiTokenRouteRule("GET", "/api/contests/contest_1/scoreboard/chart")?.requiredScope,
    ).toBe("contests:read");
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
