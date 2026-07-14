import { parseRelativePath } from "@nojv/core";

function versionSegment(version: string): string {
  const parsed = parseRelativePath(version);
  if (parsed.includes("/")) throw new Error("Storage object version must be one path segment");
  return parsed;
}

export const testcaseInputKey = (
  problemId: string,
  testcaseId: string,
  version: string,
): string =>
  `problems/${problemId}/testcases/${testcaseId}/versions/${versionSegment(version)}/input`;

export const testcaseOutputKey = (
  problemId: string,
  testcaseId: string,
  version: string,
): string =>
  `problems/${problemId}/testcases/${testcaseId}/versions/${versionSegment(version)}/output`;

export const testcaseInputFileKey = (
  problemId: string,
  testcaseId: string,
  version: string,
  filename: string,
): string => {
  const parsed = parseRelativePath(filename);
  if (parsed.includes("/")) {
    throw new Error("testcaseInputFileKey: unsafe filename");
  }
  return `problems/${problemId}/testcases/${testcaseId}/versions/${versionSegment(version)}/files/${parsed}`;
};

export const workspaceFileKey = (
  problemId: string,
  fileId: string,
  version: string,
): string =>
  `problems/${problemId}/workspace/${fileId}/versions/${versionSegment(version)}`;

export const checkerKey = (problemId: string, version: string): string =>
  `problems/${problemId}/validators/${versionSegment(version)}/checker`;

export const interactorKey = (problemId: string, version: string): string =>
  `problems/${problemId}/validators/${versionSegment(version)}/interactor`;

export const problemPrefix = (problemId: string): string => `problems/${problemId}/`;

export const submissionPrefix = (submissionId: string): string =>
  `submissions/${submissionId}/`;

export const submissionSourceKey = (
  submissionId: string,
  generation: string,
  path: string,
): string =>
  `submissions/${submissionId}/source-generations/${versionSegment(generation)}/files/${parseRelativePath(path)}`;

export const submissionSourceManifestKey = (
  submissionId: string,
  generation: string,
): string =>
  `submissions/${submissionId}/source-generations/${versionSegment(generation)}/manifest.json`;

export const submissionVerdictDetailKey = (
  submissionId: string,
  judgeRunId: string,
): string =>
  `submissions/${submissionId}/judge-runs/${versionSegment(judgeRunId)}/verdict-detail.json`;
