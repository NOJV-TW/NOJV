import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const { buildScaffoldZip, scaffoldEntryNames, scaffoldZipFilename } =
  await import("$lib/server/advanced-scaffold");

const EXPECTED_ENTRIES = [
  "grade/answers/case-01.out",
  "grade/answers/case-02.out",
  "grade/Dockerfile",
  "grade/grader.py",
  "grade/nojv_grader.py",
  "grade/README.md",
  "nojv-advanced.yaml",
  "run/Dockerfile",
  "run/nojv_runner.py",
  "run/README.md",
  "run/runner.py",
  "run/testcases/case-01.in",
  "run/testcases/case-02.in",
  "samples/full-credit.zip",
].sort((a, b) => a.localeCompare(b));

async function unzip(): Promise<Record<string, string>> {
  const blob = await buildScaffoldZip();
  expect(blob.size).toBeGreaterThan(0);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out: Record<string, string> = {};
  for (const file of Object.values(zip.files)) {
    if (!file.dir) {
      out[file.name] = file.name.endsWith(".zip") ? "<zip>" : await file.async("string");
    }
  }
  return out;
}

describe("advanced-scaffold", () => {
  it("bundles one canonical Advanced package", async () => {
    expect(scaffoldEntryNames()).toEqual(EXPECTED_ENTRIES);
    const files = await unzip();
    expect(Object.keys(files).sort((a, b) => a.localeCompare(b))).toEqual(EXPECTED_ENTRIES);
  });

  it("includes the package manifest as the source of truth", async () => {
    const files = await unzip();
    expect(files["nojv-advanced.yaml"]).toContain("version: 1");
    expect(files["nojv-advanced.yaml"]).toContain("maxScore: 100");
    expect(files["nojv-advanced.yaml"]).toContain("requiredPaths:");
    expect(files["nojv-advanced.yaml"]).toContain("mode: none");
    expect(files["nojv-advanced.yaml"]).toContain("samples:");
    expect(files["nojv-advanced.yaml"]).toContain("samples/full-credit.zip");
  });

  it("includes a runnable full-credit sample submission zip", async () => {
    const blob = await buildScaffoldZip();
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sampleBytes = await zip.file("samples/full-credit.zip")?.async("uint8array");
    expect(sampleBytes).toBeDefined();
    const sampleZip = await JSZip.loadAsync(sampleBytes!);
    expect(await sampleZip.file("main.py")?.async("string")).toContain("sum(map(int");
  });

  it("run scaffold runs the student and writes outputs, holds no answers", async () => {
    const files = await unzip();
    expect(files["run/Dockerfile"]).toContain("FROM python:3.12-slim");
    expect(files["run/Dockerfile"]).toContain("COPY testcases/ /testcases/");
    expect(files["run/runner.py"]).toContain("import nojv_runner");
    expect(files["run/nojv_runner.py"]).toContain("def run_submission");
    expect(files["run/nojv_runner.py"]).toContain("/workspace/output");
    expect(files["run/Dockerfile"]).not.toContain("answers");
  });

  it("grade scaffold reads run-output + answers and writes result.json", async () => {
    const files = await unzip();
    expect(files["grade/Dockerfile"]).toContain("COPY answers/ /answers/");
    expect(files["grade/nojv_grader.py"]).toContain("def write_result");
    expect(files["grade/nojv_grader.py"]).toContain("run-output");
    expect(files["grade/nojv_grader.py"]).toContain("result.json");
    expect(files["grade/nojv_grader.py"]).toContain("runStatus");
    expect(files["grade/grader.py"]).toContain("import nojv_grader");
  });

  it("uses one package download filename", () => {
    expect(scaffoldZipFilename()).toBe("nojv-advanced-package-starter.zip");
  });
});
