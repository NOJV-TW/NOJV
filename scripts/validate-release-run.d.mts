export function validateReleaseRun(input: {
  event?: string;
  ref?: string;
  refName?: string;
  repository?: string;
  expectedRepository?: string;
  releaseSha?: string;
  checkedOutSha?: string;
  mainContainsRelease?: boolean;
  checkRuns?: Array<{
    name?: string;
    head_sha?: string;
    status?: string;
    conclusion?: string;
    app?: { slug?: string };
  }>;
}): { releaseSha: string; imageTag: string };

export function validateDeployAdvance(input: {
  releaseSha?: string;
  deployCommitLine: string;
  isAncestor: (ancestor: string, candidate: string) => boolean;
}): { deployTip: string };

export function validatePublicationState(input: {
  releaseSha: string;
  imageTag: string;
  remoteDeployTags: string[];
  packageTags: Record<string, string[]>;
}): { existingImages: string[] };

export function validatePublishedImage(input: {
  releaseSha: string;
  imageTag: string;
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
