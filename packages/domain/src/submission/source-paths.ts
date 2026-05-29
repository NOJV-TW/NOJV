import { entryFileNameFor, type SubmissionDraft } from "@nojv/core";
import { submissionSourceKey, type SubmissionSource } from "@nojv/storage";

import { ConflictError } from "../shared/errors";

const MAX_SUBMISSION_BYTES = 1 * 1024 * 1024; // 1 MB total

export function normalizeSubmissionSources(
  payload: SubmissionDraft,
  problem: { type: string },
  submissionId: string,
): SubmissionSource[] {
  const sources: SubmissionSource[] = [];

  if (payload.sourceFiles && payload.sourceFiles.length > 0) {
    for (const file of payload.sourceFiles) {
      submissionSourceKey(submissionId, file.path);
      sources.push({ path: file.path, content: file.content });
    }
  } else {
    void problem;
    if (!payload.sourceCode) {
      throw new ConflictError("Submission missing source content.");
    }
    const path = entryFileNameFor(payload.language);
    submissionSourceKey(submissionId, path);
    sources.push({ path, content: payload.sourceCode });
  }

  let totalBytes = 0;
  for (const source of sources) {
    totalBytes += Buffer.byteLength(source.content, "utf-8");
  }
  if (totalBytes > MAX_SUBMISSION_BYTES) {
    throw new ConflictError("Submission exceeds 1 MB total");
  }

  return sources;
}
