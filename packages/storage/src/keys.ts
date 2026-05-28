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

export const checkerKey = (problemId: string): string =>
  `problems/${problemId}/validator/checker`;

export const interactorKey = (problemId: string): string =>
  `problems/${problemId}/validator/interactor`;

export const problemPrefix = (problemId: string): string => `problems/${problemId}/`;

export const submissionPrefix = (submissionId: string): string =>
  `submissions/${submissionId}/`;

export const submissionSourcePrefix = (submissionId: string): string =>
  `submissions/${submissionId}/sources/`;

/**
 * Validates a caller-supplied relative path before joining it onto the
 * submission sources prefix. Rejects empty strings, parent traversal, absolute
 * paths, backslashes, and NUL bytes so a malicious source path cannot escape
 * the submission's S3 namespace.
 */
export const submissionSourceKey = (submissionId: string, path: string): string => {
  if (path.length === 0) {
    throw new Error("submissionSourceKey: path must not be empty");
  }
  if (path.startsWith("/")) {
    throw new Error("submissionSourceKey: path must not be absolute");
  }
  if (path.includes("\\")) {
    throw new Error("submissionSourceKey: path must not contain backslashes");
  }
  if (path.includes("\0")) {
    throw new Error("submissionSourceKey: path must not contain NUL");
  }
  // eslint-disable-next-line no-control-regex -- control chars are exactly what we're rejecting
  if (/[\x01-\x1f\x7f]/.test(path)) {
    throw new Error("submissionSourceKey: path must not contain control characters");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("submissionSourceKey: path must not contain parent traversal");
  }
  return `${submissionSourcePrefix(submissionId)}${path}`;
};

export const submissionVerdictDetailKey = (submissionId: string): string =>
  `submissions/${submissionId}/verdict-detail.json`;
