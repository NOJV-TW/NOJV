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

const MANIFEST = `version: 1

scoring:
  maxScore: 100

resources:
  timeLimitMs: 30000
  memoryLimitMb: 512

student:
  requiredPaths:
    - main.py

network:
  mode: none
  allowlist: []

samples:
  - name: full-credit
    submission: samples/full-credit.zip
    expect:
      verdict: accepted
      score: 100
`;

function packageEntries(): [string, string][] {
  return Object.entries(SCAFFOLD_FILES).filter(([path]) => !path.startsWith("service/"));
}

export function scaffoldEntryNames(): string[] {
  return [
    "nojv-advanced.yaml",
    "samples/full-credit.zip",
    ...packageEntries().map(([path]) => path),
  ].sort((a, b) => a.localeCompare(b));
}

export function scaffoldZipFilename(): string {
  return "nojv-advanced-package-starter.zip";
}

export async function buildScaffoldZip(): Promise<Blob> {
  const zip = new JSZip();
  zip.file("nojv-advanced.yaml", MANIFEST);
  const sample = new JSZip();
  sample.file(
    "main.py",
    `import sys

for line in sys.stdin:
    print(sum(map(int, line.split())))
`,
  );
  zip.file(
    "samples/full-credit.zip",
    await sample.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
  for (const [path, content] of packageEntries()) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
