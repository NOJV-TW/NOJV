import type { SandboxRequest } from "@nojv/core";
import { describe, expect, it } from "vitest";

import { resolveSourceFiles } from "../../../apps/worker/src/services/source-files";

function base(): SandboxRequest {
  return {
    submissionId: "sub-1",
    sourceCode: "print(1)",
    language: "python",
    problemType: "full_source",
    testcases: [],
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 1_000, memoryMb: 256 },
  };
}

describe("resolveSourceFiles", () => {
  it("falls back to sourceCode when sourceFiles is absent", () => {
    const files = resolveSourceFiles(base());
    expect(files).toEqual([{ path: "main.py", content: "print(1)" }]);
  });

  it("falls back to sourceCode when sourceFiles is empty", () => {
    const files = resolveSourceFiles({ ...base(), sourceFiles: [] });
    expect(files).toEqual([{ path: "main.py", content: "print(1)" }]);
  });

  it("includes explicit main file and does not add a second fallback", () => {
    const files = resolveSourceFiles({
      ...base(),
      sourceFiles: [{ path: "main.py", content: "# explicit" }],
    });
    expect(files).toEqual([{ path: "main.py", content: "# explicit" }]);
  });

  it("returns multiple files in declaration order with fallback appended last", () => {
    const files = resolveSourceFiles({
      ...base(),
      language: "cpp",
      sourceCode: "int main(){}",
      sourceFiles: [
        { path: "helper.cpp", content: "// helper" },
        { path: "utils/algo.cpp", content: "// algo" },
      ],
    });
    expect(files).toEqual([
      { path: "helper.cpp", content: "// helper" },
      { path: "utils/algo.cpp", content: "// algo" },
      { path: "main.cpp", content: "int main(){}" },
    ]);
  });

  it("throws when a source file path is unsafe", () => {
    expect(() =>
      resolveSourceFiles({
        ...base(),
        sourceFiles: [
          { path: "../evil.py", content: "bad" },
          { path: "helper.py", content: "# ok" },
        ],
      }),
    ).toThrow("Path contains unsafe segments");
  });

  it("does not normalize Windows or leading-dot paths", () => {
    expect(() =>
      resolveSourceFiles({
        ...base(),
        language: "cpp",
        sourceCode: "int main(){}",
        sourceFiles: [{ path: String.raw`.\sub\helper.cpp`, content: "// win" }],
      }),
    ).toThrow("Path contains unsafe characters");
  });

  it("returns multiple files in declaration order when every path is valid", () => {
    const files = resolveSourceFiles({
      ...base(),
      sourceFiles: [
        { path: "helper.py", content: "# ok" },
        { path: "src/util.py", content: "# util" },
      ],
    });
    expect(files.map((f) => f.path)).toEqual(["helper.py", "src/util.py", "main.py"]);
  });

  it("requireSourceCode: true — suppresses fallback when sourceCode is empty string", () => {
    const files = resolveSourceFiles(
      { ...base(), sourceCode: "" },
      { requireSourceCode: true },
    );
    expect(files).toEqual([]);
  });

  it("requireSourceCode: true — includes fallback when sourceCode is non-empty", () => {
    const files = resolveSourceFiles(
      { ...base(), sourceCode: "x=1" },
      { requireSourceCode: true },
    );
    expect(files).toEqual([{ path: "main.py", content: "x=1" }]);
  });

  it("requireSourceCode: false (default) — always includes fallback even for empty sourceCode", () => {
    const files = resolveSourceFiles({ ...base(), sourceCode: "" });
    expect(files).toEqual([{ path: "main.py", content: "" }]);
  });
});
