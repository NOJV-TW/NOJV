export function validateReleaseRun(input: {
  workflowName?: string;
  workflowPath?: string;
  event?: string;
  conclusion?: string;
  branch?: string;
  repository?: string;
  expectedRepository?: string;
  releaseSha?: string;
  checkedOutSha?: string;
}): { releaseSha: string; imageTag: string };

export function validateDeployAdvance(input: {
  releaseSha?: string;
  deployCommitLine: string;
  isAncestor: (ancestor: string, candidate: string) => boolean;
}): { deployTip: string };

export function validatePublicationAbsence(input: {
  releaseSha: string;
  remoteDeployTags: string[];
  packageTags: Record<string, string[]>;
}): void;
