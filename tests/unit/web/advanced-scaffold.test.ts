import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const { buildScaffoldZip, scaffoldEntryNames, scaffoldZipFilename } =
  await import("$lib/server/advanced-scaffold");

const EXPECTED_ENTRIES = [
  "README.md",
  "grade/answers/case-01.out",
  "grade/answers/case-02.out",
  "grade/Dockerfile",
  "grade/grader.py",
  "grade/nojv_grader.py",
  "grade/README.md",
  "run/Dockerfile",
  "run/nojv_runner.py",
  "run/README.md",
  "run/runner.py",
  "run/testcases/case-01.in",
  "run/testcases/case-02.in",
  "service/Dockerfile",
  "service/README.md",
  "service/service.py",
].sort((a, b) => a.localeCompare(b));

async function unzip(): Promise<Record<string, string>> {
  const blob = await buildScaffoldZip();
  expect(blob.size).toBeGreaterThan(0);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out: Record<string, string> = {};
  for (const file of Object.values(zip.files)) {
    if (!file.dir) {
      out[file.name] = await file.async("string");
    }
  }
  return out;
}

describe("advanced-scaffold", () => {
  it("bundles the three image templates plus a top-level guide", async () => {
    expect(scaffoldEntryNames()).toEqual(EXPECTED_ENTRIES);
    const files = await unzip();
    expect(Object.keys(files).sort((a, b) => a.localeCompare(b))).toEqual(EXPECTED_ENTRIES);
  });

  it("includes a top-level README describing the build → push → reference workflow", async () => {
    const files = await unzip();
    expect(files["README.md"]).toContain("docker build");
    expect(files["README.md"]).toContain("docker push");
    expect(files["README.md"]).toContain("@sha256:");
    expect(files["README.md"]).toContain("run/");
    expect(files["README.md"]).toContain("grade/");
    expect(files["README.md"]).toContain("service/");
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

  it("includes an optional service template", async () => {
    const files = await unzip();
    expect(files["service/Dockerfile"]).toContain("FROM python:3.12-slim");
    expect(files["service/service.py"]).toBeDefined();
  });

  it("uses the image-templates download filename", () => {
    expect(scaffoldZipFilename()).toBe("nojv-advanced-image-templates.zip");
  });
});
