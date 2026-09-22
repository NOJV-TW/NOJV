import { describe, expect, it } from "vitest";
import { isExamPasswordSecurityRequest } from "$lib/server/exam-password-policy";

describe("temporary exam sign-in security boundary", () => {
  it.each([
    ["/settings", "POST"],
    ["/account/change-password", "POST"],
    ["/account/api-tokens", "POST"],
    ["/account/api-tokens/verify", "POST"],
    ["/complete-profile", "POST"],
    ["/verify-school", "POST"],
    ["/api/account/avatar", "POST"],
    ["/api/registry/token", "GET"],
    ["/api/api-token-access", "GET"],
    ["/api/admin-mode", "POST"],
    ["/users/student", "POST"],
  ])("blocks permanent account authority via %s %s", (path, method) => {
    expect(isExamPasswordSecurityRequest(path, method)).toBe(true);
  });

  it.each([
    ["/exams/exam-1", "POST"],
    ["/api/submissions", "POST"],
    ["/courses/course-1", "GET"],
    ["/account", "GET"],
    ["/settings", "GET"],
    ["/settings-unrelated", "POST"],
  ])("preserves ordinary coursework requests %s %s", (path, method) => {
    expect(isExamPasswordSecurityRequest(path, method)).toBe(false);
  });
});
