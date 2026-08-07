import { describe, expect, it } from "vitest";

import { MAX_SUBMISSION_BODY_BYTES, type SubmissionDraft } from "@nojv/core";
import { normalizeSubmissionSources } from "../../../packages/application/src/submission/source-paths";

describe("normalizeSubmissionSources", () => {
  it("keeps 200 uploaded files within the shared 2 MiB boundary", () => {
    const sourceFiles = Array.from({ length: 200 }, (_, index) => ({
      path: `file-${String(index)}.txt`,
      content: "x".repeat(10_000),
    }));

    const sources = normalizeSubmissionSources({
      context: { type: "practice" },
      language: "python",
      problemId: "many-files",
      sourceCode: "// advanced-mode upload",
      sourceFiles,
    } satisfies SubmissionDraft);

    expect(sources).toHaveLength(200);
    expect(
      sources.reduce((total, source) => total + Buffer.byteLength(source.content), 0),
    ).toBeLessThanOrEqual(MAX_SUBMISSION_BODY_BYTES);
  });
});
