import { describe, expect, it } from "vitest";

import { buildSubmissionBody } from "$lib/services/submission-service";

describe("buildSubmissionBody", () => {
  it("serializes virtual submissions with participationId", () => {
    const body = buildSubmissionBody({
      language: "cpp",
      participationId: "participation_1",
      problemId: "problem_1",
      sampleOnly: false,
      sourceCode: "int main() {}",
    });

    expect(body).toMatchObject({
      language: "cpp",
      mode: "virtual",
      participationId: "participation_1",
      problemId: "problem_1",
      sampleOnly: false,
      sourceCode: "int main() {}",
    });
    expect(body).not.toHaveProperty("virtualContestId");
  });

  it("keeps contest mode ahead of virtual participation when both contexts exist", () => {
    const body = buildSubmissionBody({
      contestId: "contest_1",
      language: "cpp",
      participationId: "participation_1",
      problemId: "problem_1",
      sourceCode: "int main() {}",
    });

    expect(body).toMatchObject({
      contestId: "contest_1",
      mode: "contest",
      participationId: "participation_1",
      sampleOnly: false,
    });
  });

  it("includes advanced source files without dropping the placeholder source", () => {
    const body = buildSubmissionBody({
      language: "cpp",
      problemId: "problem_1",
      sourceCode: "// advanced-mode upload",
      sourceFiles: [{ path: "main.cpp", content: "int main() {}" }],
    });

    expect(body).toMatchObject({
      mode: "practice",
      sourceCode: "// advanced-mode upload",
      sourceFiles: [{ path: "main.cpp", content: "int main() {}" }],
    });
  });
});
