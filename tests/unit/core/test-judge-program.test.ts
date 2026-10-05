import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PYTHON_INTERACTOR_WRAPPER,
  PYTHON_VALIDATOR_WRAPPER,
  WASM_OJ_SERVER_IDENTITY,
  WASM_OJ_SERVER_VERSIONS,
  cppStandardHeader,
  deserialiseBuildArtifact,
  judgeProgramCompileInput,
  pythonJudgeWrapper,
  serialiseBuildArtifact,
  serialisedBuildArtifactSchema,
  testJudgeProgramCacheKey,
  testJudgeProgramObjectKey,
  type JudgeProgramSource,
} from "@nojv/core";

const cppChecker: JudgeProgramSource = {
  role: "checker",
  language: "cpp",
  source: "#include <cstdio>\nint main() { return 42; }\n",
};

describe("WASM_OJ_SERVER_IDENTITY", () => {
  it("names the pinned server and toolchain versions", () => {
    const { server, clang, python } = WASM_OJ_SERVER_VERSIONS;
    expect(WASM_OJ_SERVER_IDENTITY).toBe(
      `wasm-oj-server@${server}+clang@${clang}+python@${python}`,
    );
  });
});

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

describe("testJudgeProgramCacheKey", () => {
  function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  it.each<JudgeProgramSource>([
    cppChecker,
    { role: "checker", language: "python", source: "accept()\n" },
    { role: "interactor", language: "python", source: "accept()\n" },
  ])("hashes the toolchain identity and the exact compile input (%o)", async (program) => {
    const compileInput = judgeProgramCompileInput(program, "<wasm-oj-pch>");
    const key = await testJudgeProgramCacheKey(program);

    expect(key).toBe(
      sha256(JSON.stringify([WASM_OJ_SERVER_IDENTITY, JSON.stringify(compileInput)])),
    );
    expect(await testJudgeProgramCacheKey({ ...program })).toBe(key);
  });

  it.each<Partial<JudgeProgramSource>>([
    { language: "python" },
    { source: "#include <cstdio>\nint main() { return 43; }\n" },
    { source: "#include <bits/stdc++.h>\nint main() { return 42; }\n" },
  ])("changes when the compile input changes (%o)", async (change) => {
    expect(await testJudgeProgramCacheKey({ ...cppChecker, ...change })).not.toBe(
      await testJudgeProgramCacheKey(cppChecker),
    );
  });

  it("changes with the role of a Python program, whose wrapper depends on it", async () => {
    const checker = { role: "checker", language: "python", source: "x = 1\n" } as const;

    expect(await testJudgeProgramCacheKey({ ...checker, role: "interactor" })).not.toBe(
      await testJudgeProgramCacheKey(checker),
    );
  });

  it("shares one build between a C++ checker and interactor with the same source", async () => {
    expect(await testJudgeProgramCacheKey({ ...cppChecker, role: "interactor" })).toBe(
      await testJudgeProgramCacheKey(cppChecker),
    );
  });
});

describe("testJudgeProgramObjectKey", () => {
  it("stores programs under the versioned test-judge prefix", () => {
    expect(testJudgeProgramObjectKey("ab12")).toBe("test-judge-programs/v1/ab12.json");
  });
});

describe("build artifact wire format", () => {
  const wasm = {
    kind: "wasm" as const,
    language: "cpp",
    size: 5,
    bytes: new Uint8Array([0, 97, 115, 109, 255]),
  };
  const bundle = {
    kind: "runtime-bundle" as const,
    language: "python",
    files: { "main.py": "print(1)\n", "lib.pyc": new Uint8Array([1, 2, 3, 250]) },
  };

  it.each([
    ["wasm", wasm],
    ["runtime-bundle", bundle],
  ] as const)("round-trips a %s artifact through JSON", (_kind, artifact) => {
    const wire: unknown = JSON.parse(JSON.stringify(serialiseBuildArtifact(artifact)));
    const parsed = serialisedBuildArtifactSchema.parse(wire);

    expect(deserialiseBuildArtifact(parsed)).toEqual(artifact);
  });

  it("encodes bytes as base64 and keeps text files as text", () => {
    expect(serialiseBuildArtifact(wasm)).toEqual({
      kind: "wasm",
      language: "cpp",
      size: 5,
      bytes: { base64: "AGFzbf8=" },
    });
    expect(serialiseBuildArtifact(bundle)).toMatchObject({
      files: { "main.py": "print(1)\n", "lib.pyc": { base64: "AQID+g==" } },
    });
  });

  it("round-trips bytes larger than one encoding chunk", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => (index * 31) % 256);
    const restored = deserialiseBuildArtifact(serialiseBuildArtifact({ kind: "wasm", bytes }));

    expect(restored.kind === "wasm" && restored.bytes).toEqual(bytes);
  });
});
