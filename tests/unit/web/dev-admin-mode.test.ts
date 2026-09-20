import { describe, expect, it } from "vitest";

import { isDevAdminModeBypassEnabled } from "$lib/server/dev-admin-mode";

const admin = {
  username: "admin-test",
  platformRole: "admin" as const,
  isSuperAdmin: false,
  disabled: false,
};

describe("development admin-mode bypass", () => {
  it("enables the configured admin username in development", () => {
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

  it("keeps the bypass disabled when the username is not configured", () => {
    expect(
      isDevAdminModeBypassEnabled(admin, {
        NODE_ENV: "test",
      }),
    ).toBe(false);
  });

  it("requires the exact enabled username and a non-privileged admin", () => {
    const config = { NODE_ENV: "development" as const, DEV_ADMIN_MODE_USERNAME: "admin-test" };

    expect(isDevAdminModeBypassEnabled({ ...admin, username: "other-admin" }, config)).toBe(
      false,
    );
    expect(isDevAdminModeBypassEnabled({ ...admin, isSuperAdmin: true }, config)).toBe(false);
    expect(isDevAdminModeBypassEnabled({ ...admin, disabled: true }, config)).toBe(false);
    expect(isDevAdminModeBypassEnabled({ ...admin, platformRole: "teacher" }, config)).toBe(
      false,
    );
  });
});
