import type * as Monaco from "monaco-editor";

const NOJV_LIGHT_THEME = "nojv-light";
const NOJV_DARK_THEME = "nojv-dark";

let defined = false;

export function defineNojvThemes(monaco: typeof Monaco): void {
  if (defined) return;
  monaco.editor.defineTheme(NOJV_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.lineHighlightBackground": "#eef2f7",
      "editor.lineHighlightBorder": "#00000000",
    },
  });
  monaco.editor.defineTheme(NOJV_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.lineHighlightBackground": "#2a2d2e",
      "editor.lineHighlightBorder": "#00000000",
    },
  });
  defined = true;
}

export function getNojvThemeName(isDark: boolean): string {
  return isDark ? NOJV_DARK_THEME : NOJV_LIGHT_THEME;
}
