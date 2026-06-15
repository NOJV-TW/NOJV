import JSZip from "jszip";

export type ScaffoldRole = "run" | "grade" | "service";

export const SCAFFOLD_ROLES: readonly ScaffoldRole[] = ["run", "grade", "service"];

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

export function isScaffoldRole(value: string): value is ScaffoldRole {
  return (SCAFFOLD_ROLES as readonly string[]).includes(value);
}

function entriesForRole(role: ScaffoldRole): [string, string][] {
  const prefix = `${role}/`;
  return Object.entries(SCAFFOLD_FILES)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, content]) => [path.slice(prefix.length), content]);
}

export function scaffoldEntryNames(role: ScaffoldRole): string[] {
  return entriesForRole(role)
    .map(([path]) => path)
    .sort((a, b) => a.localeCompare(b));
}

export function scaffoldZipFilename(role: ScaffoldRole): string {
  return `nojv-advanced-${role}-starter.zip`;
}

export async function buildScaffoldZip(role: ScaffoldRole): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of entriesForRole(role)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
