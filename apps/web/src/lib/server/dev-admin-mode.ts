import type { PlatformRole } from "@nojv/core";

export const DEV_ADMIN_MODE_COOKIE = "nojv-dev-admin-mode";

export interface DevAdminModeConfig {
  DEV_ADMIN_MODE_USERNAME: string;
  NODE_ENV: "development" | "test" | "production";
}

export interface DevAdminModeUser {
  disabled: boolean;
  isSuperAdmin: boolean;
  platformRole: PlatformRole;
  username: string | null;
}

export function isDevAdminModeBypassEnabled(
  user: DevAdminModeUser,
  config: DevAdminModeConfig,
  bypassDisabled = false,
): boolean {
  return (
    (config.NODE_ENV === "development" || config.NODE_ENV === "test") &&
    !bypassDisabled &&
    config.DEV_ADMIN_MODE_USERNAME.length > 0 &&
    user.platformRole === "admin" &&
    !user.isSuperAdmin &&
    !user.disabled &&
    user.username === config.DEV_ADMIN_MODE_USERNAME
  );
}
