const monacoLanguageMap: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  go: "go",
  java: "java",
  javascript: "javascript",
  python: "python",
  rust: "rust",
  typescript: "typescript",
  py: "python",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  rs: "rust",
  json: "json",
  md: "markdown",
  html: "html",
  css: "css",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  txt: "plaintext",
  makefile: "makefile",
  sh: "shell",
};

export function getMonacoLanguage(langOrExt: string): string {
  return monacoLanguageMap[langOrExt] ?? "plaintext";
}
