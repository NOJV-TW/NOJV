import { describe, expect, it } from "vitest";
import {
  judgeEnvironment,
  judgeEnvironmentDefinition,
  materializeJudgeCommand,
  supportedLanguages,
  type Language,
} from "@nojv/core";

const expectedCommands: Record<
  Language,
  { compileCommand: string | null; runCommand: string }
> = {
  c: {
    compileCommand: "gcc -O2 -std=c17 -o main <sources>",
    runCommand: "./main",
  },
  cpp: {
    compileCommand: "g++ -O2 -std=c++20 -o main <sources>",
    runCommand: "./main",
  },
  go: {
    compileCommand: "go build -o main <source or package>",
    runCommand: "./main",
  },
  java: {
    compileCommand: "javac -d . <sources>",
    runCommand: "java -cp . Main",
  },
  javascript: { compileCommand: null, runCommand: "node main.mjs" },
  python: { compileCommand: null, runCommand: "python3 main.py" },
  rust: { compileCommand: "rustc -O -o main main.rs", runCommand: "./main" },
  typescript: {
    compileCommand: null,
    runCommand: "node --experimental-strip-types main.ts",
  },
};

describe("judge environment manifest", () => {
  it("defines every supported language and its public command contract", () => {
    expect(Object.keys(judgeEnvironmentDefinition.languages)).toEqual(supportedLanguages);

    for (const language of supportedLanguages) {
      expect(judgeEnvironment.languages[language].compileCommand).toBe(
        expectedCommands[language].compileCommand,
      );
      expect(judgeEnvironment.languages[language].runCommand).toBe(
        expectedCommands[language].runCommand,
      );
    }
  });

  it("rejects unresolved command placeholders", () => {
    expect(() => materializeJudgeCommand(["gcc", "{sources}"], {})).toThrow(
      "Missing judge command replacement for {sources}.",
    );
  });
});
