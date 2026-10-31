import { describe, expect, it } from "vitest";

import { isDevAdminModeBypassEnabled } from "#lib/server/dev-admin-mode.js";

const admin = {
  username: "admin-test",
  platformRole: "admin" as const,
  isSuperAdmin: false,
  disabled: false,
};

describe("development admin login bypass", () => {
  it("enables the configured local admin account in development", () => {
    expect(
      isDevAdminModeBypassEnabled(admin, {
        NODE_ENV: "development",
        DEV_ADMIN_MODE_USERNAME: "admin-test",
      }),
    ).toBe(true);
  });

  it("never enables the bypass in production", () => {
    expect(
      isDevAdminModeBypassEnabled(admin, {
        NODE_ENV: "production",
        DEV_ADMIN_MODE_USERNAME: "admin-test",
      }),
    ).toBe(false);
  });

  it("requires the exact non-super-admin account", () => {
    const config = { NODE_ENV: "development" as const, DEV_ADMIN_MODE_USERNAME: "admin-test" };

    expect(isDevAdminModeBypassEnabled({ ...admin, username: "other-admin" }, config)).toBe(
      false,
    );
    expect(isDevAdminModeBypassEnabled({ ...admin, isSuperAdmin: true }, config)).toBe(false);
    expect(isDevAdminModeBypassEnabled({ ...admin, disabled: true }, config)).toBe(false);
  });
});
