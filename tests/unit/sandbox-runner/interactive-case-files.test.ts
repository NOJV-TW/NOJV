import { describe, expect, it } from "vitest";
import { resolveInteractiveCaseFiles } from "../../../apps/sandbox-runner/src/judges/interactive-isolated.js";

describe("resolveInteractiveCaseFiles", () => {
  it("uses the shared flat layout for the requested case", () => {
    expect(resolveInteractiveCaseFiles("/submission", 7)).toEqual({
      inputFile: "/submission/case-7-input.txt",
      answerFile: "/submission/case-7-answer.txt",
    });
  });
});
