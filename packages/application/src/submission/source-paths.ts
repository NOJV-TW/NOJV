import { entryFileNameFor, parseRelativePath, type SubmissionDraft } from "@nojv/core";
import type { SubmissionSource } from "@nojv/storage";

import { ConflictError } from "../shared/errors";

const MAX_SUBMISSION_BYTES = 1 * 1024 * 1024;

export function normalizeSubmissionSources(payload: SubmissionDraft): SubmissionSource[] {
  const sources: SubmissionSource[] = [];

  if (payload.sourceFiles && payload.sourceFiles.length > 0) {
    for (const file of payload.sourceFiles) {
      const path = parseRelativePath(file.path);
      sources.push({ path, content: file.content });
    }
  } else {
    if (!payload.sourceCode) {
      throw new ConflictError("Submission missing source content.");
    }
    const path = entryFileNameFor(payload.language);
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
