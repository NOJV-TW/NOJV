export type ThemeMode = "light" | "dark" | "system";
export type ExplicitThemeMode = Exclude<ThemeMode, "system">;

const THEME_KEY = "nojv-theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (isThemeMode(raw)) return raw;
  } catch {
    return "system";
  }
  return "system";
}

export function persistThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    return;
  }
}

export function resolveIsDark(mode: ThemeMode, systemPrefersDark: boolean): boolean {
  return mode === "system" ? systemPrefersDark : mode === "dark";
}

export function toggleThemeMode(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): ExplicitThemeMode {
  return resolveIsDark(mode, systemPrefersDark) ? "light" : "dark";
}
