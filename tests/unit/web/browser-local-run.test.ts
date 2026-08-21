import { describe, expect, it } from "vitest";

import {
  browserLocalFiles,
  browserLocalErrorResult,
  browserLocalStdin,
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
    ).toEqual({
      entry: "main.cpp",
      files: {
        "main.cpp": "int main() {}",
        "include/value.hpp": "#pragma once",
      },
    });
  });

  it("provides a browser-compatible bits/stdc++.h header", () => {
    const result = browserLocalFiles({
      context: { type: "practice" },
      language: "cpp",
      problemId: "problem_1",
      sourceCode: "#include <bits/stdc++.h>\nint main() {}",
    });

    expect(result.files["main.cpp"]).toContain('#include "bits/stdc++.h"');
    expect(result.files["bits/stdc++.h"]).toContain("#include <vector>");
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

  it("terminates non-empty Python input with a newline", () => {
    expect(browserLocalStdin("python", "1 2")).toBe("1 2\n");
    expect(browserLocalStdin("python", "1 2\n")).toBe("1 2\n");
    expect(browserLocalStdin("cpp", "1 2")).toBe("1 2");
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

    expect(result).toMatchObject({ index: 2, verdict: "AC", timeMs: 12, memoryKb: 2 });
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

  it("keeps browser compiler errors visible to local testers", () => {
    expect(browserLocalErrorResult(new Error("entry not found"))).toMatchObject({
      verdict: "compile_error",
      feedback: "Browser local compilation failed.\nentry not found",
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
      cases: [],
      compare: null,
      problemId: "problem_1",
      timeLimitMs: 1_000,
      memoryLimitMb: 16,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      verdict: "compile_error",
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
