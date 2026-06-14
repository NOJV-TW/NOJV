import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const {
  buildScaffoldZip,
  scaffoldEntryNames,
  scaffoldZipFilename,
  isScaffoldRole,
  SCAFFOLD_ROLES,
} = await import("$lib/server/advanced-scaffold");

const EXPECTED_ENTRIES: Record<string, string[]> = {
  run: [
    "Dockerfile",
    "nojv_runner.py",
    "README.md",
    "runner.py",
    "testcases/case-01.in",
    "testcases/case-02.in",
  ],
  grade: [
    "answers/case-01.out",
    "answers/case-02.out",
    "Dockerfile",
    "grader.py",
    "nojv_grader.py",
    "README.md",
  ],
  service: ["Dockerfile", "README.md", "service.py"],
};

async function unzip(role: "run" | "grade" | "service"): Promise<Record<string, string>> {
  const blob = await buildScaffoldZip(role);
  expect(blob.size).toBeGreaterThan(0);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out: Record<string, string> = {};
  for (const file of Object.values(zip.files)) {
    if (!file.dir) out[file.name] = await file.async("string");
  }
  return out;
}

describe("advanced-scaffold", () => {
  it("exposes the three roles", () => {
    expect([...SCAFFOLD_ROLES]).toEqual(["run", "grade", "service"]);
    expect(isScaffoldRole("run")).toBe(true);
    expect(isScaffoldRole("nope")).toBe(false);
  });

  it("bundles exactly the expected files per role", async () => {
    for (const role of ["run", "grade", "service"] as const) {
      expect([...scaffoldEntryNames(role)]).toEqual(EXPECTED_ENTRIES[role]);
      const files = await unzip(role);
      expect(Object.keys(files).sort((a, b) => a.localeCompare(b))).toEqual(
        EXPECTED_ENTRIES[role],
      );
    }
  });

  it("run scaffold runs the student and writes outputs, holds no answers", async () => {
    const files = await unzip("run");
    expect(files["Dockerfile"]).toContain("FROM python:3.12-slim");
    expect(files["Dockerfile"]).toContain("COPY testcases/ /testcases/");
    expect(files["runner.py"]).toContain("import nojv_runner");
    expect(files["nojv_runner.py"]).toContain("def run_submission");
    expect(files["nojv_runner.py"]).toContain("/workspace/output");
    expect(files["Dockerfile"]).not.toContain("answers");
  });

  it("grade scaffold reads run-output + answers and writes result.json", async () => {
    const files = await unzip("grade");
    expect(files["Dockerfile"]).toContain("COPY answers/ /answers/");
    expect(files["nojv_grader.py"]).toContain("def write_result");
    expect(files["nojv_grader.py"]).toContain("run-output");
    expect(files["nojv_grader.py"]).toContain("result.json");
    expect(files["nojv_grader.py"]).toContain("runStatus");
    expect(files["grader.py"]).toContain("import nojv_grader");
  });

  it("service scaffold prints the readiness marker", async () => {
    const files = await unzip("service");
    expect(files["service.py"]).toContain("NOJV_SERVICE_READY");
    expect(files["Dockerfile"]).toContain("FROM python:3.12-slim");
  });

  it("exposes a per-role download filename", () => {
    expect(scaffoldZipFilename("run")).toBe("nojv-advanced-run-starter.zip");
    expect(scaffoldZipFilename("grade")).toBe("nojv-advanced-grade-starter.zip");
    expect(scaffoldZipFilename("service")).toBe("nojv-advanced-service-starter.zip");
  });
});
