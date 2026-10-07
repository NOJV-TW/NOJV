import { describe, expect, it } from "vitest";

import {
  PYTHON_INTERACTOR_WRAPPER,
  PYTHON_VALIDATOR_WRAPPER,
  cppStandardHeader,
  judgeProgramCompileInput,
  judgeProgramSourceViewSchema,
  pythonJudgeWrapper,
  type JudgeProgramSource,
} from "@nojv/core";

const cppChecker: JudgeProgramSource = {
  role: "checker",
  language: "cpp",
  source: "#include <cstdio>\nint main() { return 42; }\n",
};

describe("judgeProgramCompileInput", () => {
  it.each([
    ["checker", PYTHON_VALIDATOR_WRAPPER],
    ["interactor", PYTHON_INTERACTOR_WRAPPER],
  ] as const)("prepends the DOMjudge wrapper to a Python %s", (role, wrapper) => {
    expect(pythonJudgeWrapper(role)).toBe(wrapper);
    expect(
      judgeProgramCompileInput({ role, language: "python", source: "accept()\n" }, "PCH"),
    ).toEqual({
      language: "python",
      entry: "main.py",
      files: { "main.py": `${wrapper}accept()\n` },
    });
  });

  it("gives C++ the bits/stdc++.h shim but no PCH when the source does not include it", () => {
    expect(judgeProgramCompileInput(cppChecker, "PCH")).toEqual({
      language: "cpp",
      entry: "main.cpp",
      files: {
        "main.cpp": cppChecker.source,
        "src/bits/stdc++.h": cppStandardHeader("PCH"),
      },
    });
  });

  it("adds the PCH when the C++ source includes bits/stdc++.h", () => {
    const source = "#include <bits/stdc++.h>\nint main() { return 42; }\n";

    expect(judgeProgramCompileInput({ ...cppChecker, source }, "PCH").files).toEqual({
      "main.cpp": source,
      "src/bits/stdc++.h": cppStandardHeader("PCH"),
      "wasm-oj.pch.hpp": "PCH",
    });
  });
});

describe("judgeProgramSourceViewSchema", () => {
  const view = { role: "interactor", language: "python", source: "", sha256: "f".repeat(64) };

  it("accepts the judge-program endpoint's response", () => {
    expect(judgeProgramSourceViewSchema.parse(view)).toEqual(view);
  });

  it.each([
    ["an unknown role", { role: "validator" }],
    ["an unsupported language", { language: "javascript" }],
    ["a digest that is not lowercase SHA-256 hex", { sha256: "F".repeat(64) }],
    ["a missing source", { source: undefined }],
  ])("rejects %s", (_label, change) => {
    expect(judgeProgramSourceViewSchema.safeParse({ ...view, ...change }).success).toBe(false);
  });
});
