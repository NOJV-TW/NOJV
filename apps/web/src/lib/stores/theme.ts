export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "nojv-theme";
const CYCLE: ThemeMode[] = ["system", "light", "dark"];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (isThemeMode(raw)) return raw;
  } catch {
    // localStorage may throw under private-mode quotas / SSR; fall through.
  }
  return "system";
}

export function persistThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Quota / disabled storage — silently no-op.
  }
}

export function resolveIsDark(mode: ThemeMode, systemPrefersDark: boolean): boolean {
  return mode === "system" ? systemPrefersDark : mode === "dark";
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = CYCLE.indexOf(mode);
  return CYCLE[(index + 1) % CYCLE.length] ?? "system";
}
