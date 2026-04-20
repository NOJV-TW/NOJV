/**
 * S3 key builders for testcase + workspace blobs.
 *
 * All keys are row-ID stable so the row-to-blob mapping is deterministic and
 * Prisma cascade deletes can be mirrored on S3 with a single prefix delete.
 *
 * `filename` in `testcaseInputFileKey` is intentionally NOT URL-encoded — the
 * caller (domain layer) is responsible for validating filenames before they
 * reach storage. Encoding here would silently break round-tripping with the
 * `inputFileKeys` JSON map stored on the row.
 */
export const testcaseInputKey = (problemId: string, testcaseId: string): string =>
  `problems/${problemId}/testcases/${testcaseId}/input`;

export const testcaseOutputKey = (problemId: string, testcaseId: string): string =>
  `problems/${problemId}/testcases/${testcaseId}/output`;

export const testcaseInputFileKey = (
  problemId: string,
  testcaseId: string,
  filename: string,
): string => `problems/${problemId}/testcases/${testcaseId}/files/${filename}`;

export const workspaceFileKey = (problemId: string, fileId: string): string =>
  `problems/${problemId}/workspace/${fileId}`;

export const problemPrefix = (problemId: string): string => `problems/${problemId}/`;
