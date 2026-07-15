import { describe, expect, it } from "vitest";

import { buildSubmissionBody } from "$lib/services/submission-service";

describe("buildSubmissionBody", () => {
  it("serializes virtual submissions with participationId", () => {
    const body = buildSubmissionBody({
      context: { type: "virtual", participationId: "participation_1" },
      language: "cpp",
      problemId: "problem_1",
      sampleOnly: false,
      sourceCode: "int main() {}",
    });

    expect(body).toMatchObject({
      context: { type: "virtual", participationId: "participation_1" },
      language: "cpp",
      problemId: "problem_1",
      sampleOnly: false,
      sourceCode: "int main() {}",
    });
    expect(body).not.toHaveProperty("participationId");
  });

  it("includes advanced source files without dropping the placeholder source", () => {
    const body = buildSubmissionBody({
      context: { type: "practice" },
      language: "cpp",
      problemId: "problem_1",
      sourceCode: "// advanced-mode upload",
      sourceFiles: [{ path: "main.cpp", content: "int main() {}" }],
    });

    expect(body).toMatchObject({
      context: { type: "practice" },
      sourceCode: "// advanced-mode upload",
      sourceFiles: [{ path: "main.cpp", content: "int main() {}" }],
    });
  });
});
