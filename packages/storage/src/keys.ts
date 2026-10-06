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

export const workspaceFileKey = (problemId: string, fileId: string, version: string): string =>
  `problems/${problemId}/workspace/${fileId}/versions/${versionSegment(version)}`;

export const checkerKey = (problemId: string, version: string): string =>
  `problems/${problemId}/validators/${versionSegment(version)}/checker`;

export const interactorKey = (problemId: string, version: string): string =>
  `problems/${problemId}/validators/${versionSegment(version)}/interactor`;

export const submissionSourceKey = (
  submissionId: string,
  generation: string,
  path: string,
): string =>
  `submissions/${submissionId}/source-generations/${versionSegment(generation)}/files/${parseRelativePath(path)}`;

export const submissionSourceManifestKey = (submissionId: string, generation: string): string =>
  `submissions/${submissionId}/source-generations/${versionSegment(generation)}/manifest.json`;

export const submissionVerdictDetailKey = (submissionId: string, judgeRunId: string): string =>
  `submissions/${submissionId}/judge-runs/${versionSegment(judgeRunId)}/verdict-detail.json`;

export const problemImageKey = (problemId: string, filename: string): string =>
  `problems/${versionSegment(problemId)}/images/${versionSegment(filename)}`;

export const userContentImageKey = (userId: string, filename: string): string =>
  `users/${versionSegment(userId)}/images/${versionSegment(filename)}`;

// ponytail: request blobs orphaned by a web crash between write and delete are never swept; add a bucket lifecycle expiry on this prefix
export const TEST_JUDGE_REQUEST_PREFIX = "test-judge-requests/";

export const testJudgeRequestKey = (requestId: string): string =>
  `${TEST_JUDGE_REQUEST_PREFIX}${versionSegment(requestId)}.json`;

// ponytail: input-addressed test-judge programs are never collected; add a prefix sweep if the bucket grows
export const testJudgeProgramKey = (cacheKey: string): string =>
  `test-judge-programs/v1/${versionSegment(cacheKey)}.json`;
