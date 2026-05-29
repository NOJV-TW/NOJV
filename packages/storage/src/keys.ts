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
