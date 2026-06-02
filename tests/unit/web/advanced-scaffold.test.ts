import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const { buildScaffoldZip, SCAFFOLD_ENTRY_NAMES, SCAFFOLD_ZIP_FILENAME } =
  await import("$lib/server/advanced-scaffold");

const REQUIRED_ENTRIES = [
  "Dockerfile",
  "nojv_grader.py",
  "grader.py",
  "README.md",
  "testcases/case-01.json",
  "testcases/case-02.json",
];

describe("advanced-scaffold", () => {
  it("bundles the required scaffold files", () => {
    for (const entry of REQUIRED_ENTRIES) {
      expect(SCAFFOLD_ENTRY_NAMES).toContain(entry);
    }
  });

  it("produces a non-empty zip that round-trips every entry", async () => {
    const blob = await buildScaffoldZip();
    expect(blob.size).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const fileNames = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b));
    expect(fileNames).toEqual([...SCAFFOLD_ENTRY_NAMES]);

    const dockerfile = await zip.file("Dockerfile")?.async("string");
    expect(dockerfile).toContain("FROM python:3.12-slim");
    expect(dockerfile).toContain("COPY nojv_grader.py grader.py");

    const grader = await zip.file("nojv_grader.py")?.async("string");
    expect(grader).toContain("def write_result");
  });

  it("exposes the download filename", () => {
    expect(SCAFFOLD_ZIP_FILENAME).toBe("nojv-advanced-judge-starter.zip");
  });
});
