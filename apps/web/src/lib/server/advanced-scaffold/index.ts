import JSZip from "jszip";

// Inline every scaffold source file into the server bundle at build time so
// the route works without resolving on-disk paths (which break once Vite
// bundles apps/web). Keys are paths relative to ./files; values are contents.
const rawFiles: Record<string, string> = import.meta.glob("./files/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
});

const SCAFFOLD_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(rawFiles).map(([path, content]) => [
    path.replace(/^\.\/files\//, ""),
    content,
  ]),
);

export const SCAFFOLD_ENTRY_NAMES = Object.keys(SCAFFOLD_FILES).sort();

export const SCAFFOLD_ZIP_FILENAME = "nojv-advanced-judge-starter.zip";

export async function buildScaffoldZip(): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(SCAFFOLD_FILES)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
