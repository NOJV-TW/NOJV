import JSZip from "jszip";

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

export function scaffoldEntryNames(): string[] {
  return Object.keys(SCAFFOLD_FILES).sort((a, b) => a.localeCompare(b));
}

export function scaffoldZipFilename(): string {
  return "nojv-advanced-image-templates.zip";
}

export async function buildScaffoldZip(): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(SCAFFOLD_FILES)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
