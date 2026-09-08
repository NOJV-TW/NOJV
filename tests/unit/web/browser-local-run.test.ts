import { describe, expect, it } from "vitest";

import {
  browserLocalFiles,
  browserLocalErrorResult,
  browserLocalTerminationFeedback,
  browserLocalTerminationVerdict,
  mapBrowserLocalRunResult,
  runBrowserLocally,
  shouldUseBrowserLocalRun,
  supportsBrowserLocalRun,
} from "$lib/services/browser-local-run";

type RunResult = Parameters<typeof mapBrowserLocalRunResult>[0];

function browserRun(overrides: Partial<RunResult>): RunResult {
  return {
    code: 0,
    stdout: "",
    stderr: "",
    files: {},
    durationMs: 12.4,
    executionDurationMs: 0.4,
    determinism: { randomSeed: 1, realtimeEpochMs: 0, clockStepNs: 1_000_000 },
    resources: {
      instructionBudget: 1,
      logicalTimeLimitMs: 1_000,
      memoryLimitBytes: 16 * 1024 * 1024,
      outputLimitBytes: 1_000_000,
      filesystemWriteLimitBytes: 64 * 1024 * 1024,
      filesystemEntryLimit: 4096,
      wallTimeLimitMs: 3_000,
    },
    termination: "exited",
    metrics: {
      cost: 1,
      rawCost: 1,
      baselineCost: 0,
      costProfile: "test",
      costModel: "weighted",
      operations: null,
      memoryBytes: 2_048,
      logicalTimeNs: 1,
      filesystemBytes: 0,
      filesystemEntries: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
    },
    ...overrides,
  };
}

describe("browser local run result mapping", () => {
  it.each(["c", "cpp", "go", "java", "javascript", "python", "rust", "typescript"] as const)(
    "accepts %s for browser local runs",
    (language) => {
      expect(supportsBrowserLocalRun(language)).toBe(true);
      expect(
        shouldUseBrowserLocalRun({
          sampleOnly: true,
          specialEnv: false,
          judgeType: "standard",
          language,
        }),
      ).toBe(true);
    },
  );

  it("uses the browser for Java sample runs", () => {
    expect(supportsBrowserLocalRun("java")).toBe(true);
    expect(
      shouldUseBrowserLocalRun({
        sampleOnly: true,
        specialEnv: false,
        judgeType: "standard",
        language: "java",
      }),
    ).toBe(true);
  });

  it("uses the browser only for standard sample runs", () => {
    expect(
      shouldUseBrowserLocalRun({
        sampleOnly: true,
        specialEnv: false,
        judgeType: "standard",
        language: "python",
      }),
    ).toBe(true);
    expect(
      shouldUseBrowserLocalRun({
        sampleOnly: false,
        specialEnv: false,
        judgeType: "standard",
        language: "python",
      }),
    ).toBe(false);
    expect(
      shouldUseBrowserLocalRun({
        sampleOnly: true,
        specialEnv: false,
        judgeType: "checker",
        language: "python",
      }),
    ).toBe(false);
  });

  it("preserves visible multi-file workspace paths", () => {
    expect(
      browserLocalFiles({
        context: { type: "practice" },
        language: "cpp",
        problemId: "problem_1",
        sourceCode: "int main() {}",
        sourceFiles: [
          { path: "main.cpp", content: "int main() {}" },
          { path: "include/value.hpp", content: "#pragma once" },
        ],
      }),
    ).toMatchObject({
      entry: "main.cpp",
      files: {
        "main.cpp": "int main() {}",
        "include/value.hpp": "#pragma once",
      },
    });
  });

  it.each([
    "#include <bits/stdc++.h>",
    "# include<bits/stdc++.h>",
    "#include /* header */ <bits/stdc++.h>",
    "#include\\\n<bits/stdc++.h>",
    "#define HEADER <bits/stdc++.h>\n#include HEADER",
    'const char *text = "#include <bits/stdc++.h>";',
    'const char *text = R"raw(#include <bits/stdc++.h>)raw";',
    "// #include <bits/stdc++.h>",
    "/* #include <bits/stdc++.h> */",
  ])(
    "supplies the C++ header through Clang's include path without editing %j",
    (sourceCode) => {
      const result = browserLocalFiles({
        context: { type: "practice" },
        language: "cpp",
        problemId: "problem_1",
        sourceCode,
      });

      expect(result.files["main.cpp"]).toBe(sourceCode);
      for (const header of [
        "vector",
        "list",
        "complex",
        "regex",
        "fstream",
        "valarray",
        "format",
      ]) {
        expect(result.files["src/bits/stdc++.h"]).toContain(`#include <${header}>`);
      }
    },
  );

  it.each(["bits/stdc++.h", "src/bits/stdc++.h"])("preserves a user-provided %s", (path) => {
    const result = browserLocalFiles({
      context: { type: "practice" },
      language: "cpp",
      problemId: "problem_1",
      sourceCode: "#include <bits/stdc++.h>",
      sourceFiles: [
        { path: "main.cpp", content: "#include <bits/stdc++.h>" },
        { path, content: "#define CUSTOM_HEADER 1" },
      ],
    });
    expect(result.files[path]).toBe("#define CUSTOM_HEADER 1");
    expect(result.files["src/bits/stdc++.h"]).toBe("#define CUSTOM_HEADER 1");
  });

  it("uses Main.java as the Java browser entry", () => {
    expect(
      browserLocalFiles({
        context: { type: "practice" },
        language: "java",
        problemId: "problem_1",
        sourceCode: "public class Main { public static void main(String[] args) {} }",
      }),
    ).toEqual({
      entry: "Main.java",
      files: {
        "Main.java": "public class Main { public static void main(String[] args) {} }",
      },
    });
  });

  it("maps resource termination to NOJV verdicts", () => {
    expect(browserLocalTerminationVerdict("logical-time-limit", 0)).toBe("TLE");
    expect(browserLocalTerminationVerdict("wall-time-limit", 0)).toBe("TLE");
    expect(browserLocalTerminationVerdict("memory-limit", 0)).toBe("MLE");
    expect(browserLocalTerminationVerdict("trap", 0)).toBe("RE");
    expect(browserLocalTerminationVerdict("output-limit", 0)).toBe("RE");
    expect(browserLocalTerminationFeedback("output-limit", 0)).toBe("Output limit exceeded.");
    expect(browserLocalTerminationFeedback("filesystem-limit", 0)).toBe(
      "Filesystem limit exceeded.",
    );
  });

  it("reuses the standard token comparator", () => {
    const result = mapBrowserLocalRunResult(
      browserRun({ stdout: "1  2\n" }),
      "1 2",
      { caseSensitive: true, floatTolerance: null },
      2,
    );

    expect(result).toMatchObject({ index: 2, verdict: "AC", timeMs: 1, memoryKb: 2 });
  });

  it("reports guest execution time instead of virtual clock or preparation time", () => {
    const result = mapBrowserLocalRunResult(
      browserRun({
        durationMs: 3_000,
        executionDurationMs: 15.2,
        metrics: { ...browserRun({}).metrics, logicalTimeNs: 2_500_000 },
      }),
      undefined,
      undefined,
      0,
    );

    expect(result.timeMs).toBe(16);
  });

  it("uses total duration when a runtime does not provide guest timing", () => {
    const run = browserRun({});
    delete run.executionDurationMs;
    const result = mapBrowserLocalRunResult(run, undefined, undefined, 0);

    expect(result.timeMs).toBe(13);
  });

  it("keeps wrong answers and non-zero exits distinct", () => {
    expect(
      mapBrowserLocalRunResult(browserRun({ stdout: "wrong" }), "right", undefined, 0).verdict,
    ).toBe("WA");
    expect(
      mapBrowserLocalRunResult(browserRun({ code: 1 }), undefined, undefined, 1).verdict,
    ).toBe("RE");
  });

  it("surfaces a browser runtime trap when stderr is empty", () => {
    const result = mapBrowserLocalRunResult(
      browserRun({ code: 1, termination: "trap", trapMessage: "unreachable executed" }),
      undefined,
      undefined,
      0,
    );

    expect(result).toMatchObject({ verdict: "RE", stderr: "unreachable executed" });
  });

  it("reports browser engine failures as system errors", () => {
    expect(browserLocalErrorResult(new Error("entry not found"))).toMatchObject({
      verdict: "system_error",
      feedback: "Browser local execution failed.\nentry not found",
    });
  });

  it("surfaces browser engine initialization errors", async () => {
    const result = await runBrowserLocally({
      request: {
        context: { type: "practice" },
        language: "python",
        problemId: "problem_1",
        sourceCode: "print(1)",
      },
      cases: [{ input: "1" }],
      judgeConfig: { type: "standard" },
      problemId: "problem_1",
      timeLimitMs: 1_000,
      memoryLimitMb: 16,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      verdict: "system_error",
    });
    expect(result?.feedback).toContain("A module Worker requires a browser base URL.");
  });

  it("cleans ANSI diagnostics and hides the internal runner frame", () => {
    const result = mapBrowserLocalRunResult(
      browserRun({
        code: 1,
        stderr:
          '\u001b[35mTraceback (most recent call last):\u001b[0m\n  File \u001b[35m"<frozen runpy>"\u001b[0m, line 98, in \u001b[35m_run_code\u001b[0m\n    _run_code()\n  File \u001b[35m"/project/.forge/deterministic_runner.py"\u001b[0m, line 43, in \u001b[35m<module>\u001b[0m\n    internal()\n  File \u001b[35m"/project/main.py"\u001b[0m, line 1, in \u001b[35m<module>\u001b[0m\n    \u001b[1;31ma, b\u001b[0m = map(int, input().split())\n    ^^^^\nValueError: not enough values to unpack',
      }),
      undefined,
      undefined,
      0,
    );

    expect(result.stderr).toBe(
      "Traceback (most recent call last):\n" +
        '  File "main.py", line 1, in <module>\n' +
        "    a, b = map(int, input().split())\n" +
        "ValueError: not enough values to unpack",
    );
  });
});
