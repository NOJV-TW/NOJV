import { describe, expect, it } from "vitest";

import {
  PYTHON_INTERACTOR_WRAPPER,
  PYTHON_VALIDATOR_WRAPPER,
  cppStandardHeader,
  judgeProgramCompileInput,
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
