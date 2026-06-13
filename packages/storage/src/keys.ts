import { parseRelativePath } from "@nojv/core";

export const testcaseInputKey = (problemId: string, testcaseId: string): string =>
  `problems/${problemId}/testcases/${testcaseId}/input`;

export const testcaseOutputKey = (problemId: string, testcaseId: string): string =>
  `problems/${problemId}/testcases/${testcaseId}/output`;

export const testcaseInputFileKey = (
  problemId: string,
  testcaseId: string,
  filename: string,
): string => {
  const parsed = parseRelativePath(filename);
  if (parsed.includes("/")) {
    throw new Error("testcaseInputFileKey: unsafe filename");
  }
  return `problems/${problemId}/testcases/${testcaseId}/files/${parsed}`;
};

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

export const submissionSourceStagingPrefix = (submissionId: string): string =>
  `submissions/${submissionId}/staging/sources/`;

export const submissionSourceKey = (submissionId: string, path: string): string => {
  return `${submissionSourcePrefix(submissionId)}${parseRelativePath(path)}`;
};

export const submissionSourceStagingKey = (submissionId: string, path: string): string => {
  return `${submissionSourceStagingPrefix(submissionId)}${parseRelativePath(path)}`;
};

export const submissionVerdictDetailKey = (submissionId: string): string =>
  `submissions/${submissionId}/verdict-detail.json`;
