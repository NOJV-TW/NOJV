import { entryFileNameFor, type SubmissionDraft } from "@nojv/core";
import { submissionSourceKey, type SubmissionSource } from "@nojv/storage";

import { ConflictError } from "../shared/errors";

const MAX_SUBMISSION_BYTES = 1 * 1024 * 1024; // 1 MB total

/**
 * Normalize a submission draft into the on-storage source-file list.
 *
 * - `full_source` / `special_env` carrying a single inline `sourceCode` →
 *   one file at `main.<ext>`.
 * - `multi_file` and `special_env` payloads with explicit `sourceFiles` →
 *   pass-through (still validated by `submissionSourceKey` below).
 *
 * Validates each path via `submissionSourceKey` (throws on traversal /
 * absolute / NUL / backslash) before any S3 write, and caps total bytes
 * at 1 MB to bound runaway uploads regardless of the per-file ceiling.
 */
export function normalizeSubmissionSources(
  payload: SubmissionDraft,
  problem: { type: string },
  submissionId: string,
): SubmissionSource[] {
  const sources: SubmissionSource[] = [];

  if (payload.sourceFiles && payload.sourceFiles.length > 0) {
    for (const file of payload.sourceFiles) {
      // submissionSourceKey throws on bad paths; we only need it for its
      // validation side-effect here. The actual key is rebuilt by putSubmissionSources.
      submissionSourceKey(submissionId, file.path);
      sources.push({ path: file.path, content: file.content });
    }
  } else {
    void problem;
    // `sourceCode` is optional on the schema (rejudge dispatches omit it), but
    // inbound POST without sourceFiles must carry it. Reject empty so a stray
    // rejudge-shaped payload can't sneak through and write an empty file.
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
