import type { HighlighterCore } from "shiki/core";

const THEME_LIGHT = "github-light";
const THEME_DARK = "github-dark";

const LANG_ALIASES: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  go: "go",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  python: "python",
  py: "python",
  rust: "rust",
  typescript: "typescript",
  ts: "typescript",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/oniguruma"),
    ]);
    return createHighlighterCore({
      themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
      langs: [
        import("@shikijs/langs/c"),
        import("@shikijs/langs/cpp"),
        import("@shikijs/langs/go"),
        import("@shikijs/langs/java"),
        import("@shikijs/langs/javascript"),
        import("@shikijs/langs/python"),
        import("@shikijs/langs/rust"),
        import("@shikijs/langs/typescript"),
      ],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
  })();
  return highlighterPromise;
}

export interface HighlightToken {
  content: string;
  light: string;
  dark: string;
}

export async function highlightToLines(
  code: string,
  language: string,
): Promise<HighlightToken[][]> {
  const lang = LANG_ALIASES[language.toLowerCase()];
  if (!lang) {
    return code
      .split("\n")
      .map((line) => (line ? [{ content: line, light: "", dark: "" }] : []));
  }

  const hl = await getHighlighter();
  const lines = hl.codeToTokensWithThemes(code, {
    lang,
    themes: { light: THEME_LIGHT, dark: THEME_DARK },
  });

  return lines.map((line) =>
    line.map((tok) => ({
      content: tok.content,
      light: tok.variants[THEME_LIGHT]?.color ?? "",
      dark: tok.variants[THEME_DARK]?.color ?? "",
    })),
  );
}
