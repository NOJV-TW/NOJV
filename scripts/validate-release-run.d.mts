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

export function validatePublicationState(input: {
  releaseSha: string;
  remoteDeployTags: string[];
  packageTags: Record<string, string[]>;
}): { existingImages: string[] };

export function validatePublishedImage(input: {
  releaseSha: string;
  ref: string;
  inspect: Array<{
    RepoTags?: string[];
    RepoDigests?: string[];
    Config?: { Labels?: Record<string, string> };
  }>;
}): { digest: string };

export function validateCloudBuildProvenance(input: {
  digest: string;
  imageRef: string;
  provenance: unknown;
  component: string;
  dockerfile: string;
  region: string;
  repository: string;
  releaseSha: string;
  sourceUri: string;
}): { digest: string };
