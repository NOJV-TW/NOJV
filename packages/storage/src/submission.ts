import type { S3Client } from "@aws-sdk/client-s3";

import { copyBlob, deleteBlobsByPrefix, getText, listByPrefix, putText } from "./blobs";
import {
  submissionPrefix,
  submissionSourceKey,
  submissionSourcePrefix,
  submissionSourceStagingKey,
  submissionSourceStagingPrefix,
  submissionVerdictDetailKey,
} from "./keys";

export interface SubmissionSource {
  path: string;
  content: string;
}

export async function putSubmissionSources(
  client: S3Client,
  submissionId: string,
  sources: readonly SubmissionSource[],
): Promise<void> {
  await Promise.all(
    sources.map((source) =>
      putText(client, submissionSourceKey(submissionId, source.path), source.content),
    ),
  );
}

export async function putSubmissionSourcesStaged(
  client: S3Client,
  submissionId: string,
  sources: readonly SubmissionSource[],
): Promise<void> {
  await Promise.all(
    sources.map((source) =>
      putText(client, submissionSourceStagingKey(submissionId, source.path), source.content),
    ),
  );
}

export async function promoteSubmissionSources(
  client: S3Client,
  submissionId: string,
  sources: readonly SubmissionSource[],
): Promise<void> {
  await Promise.all(
    sources.map((source) =>
      copyBlob(
        client,
        submissionSourceStagingKey(submissionId, source.path),
        submissionSourceKey(submissionId, source.path),
      ),
    ),
  );
  await deleteSubmissionStaging(client, submissionId);
}

export async function getSubmissionSources(
  client: S3Client,
  submissionId: string,
): Promise<SubmissionSource[]> {
  const prefix = submissionSourcePrefix(submissionId);
  const keys = (await listByPrefix(client, prefix)).sort((a, b) => a.localeCompare(b));

  return Promise.all(
    keys.map(async (key) => ({
      path: key.slice(prefix.length),
      content: await getText(client, key),
    })),
  );
}

export async function putVerdictDetail(
  client: S3Client,
  submissionId: string,
  detail: unknown,
): Promise<void> {
  await putText(client, submissionVerdictDetailKey(submissionId), JSON.stringify(detail));
}

export async function getVerdictDetail(
  client: S3Client,
  submissionId: string,
): Promise<unknown> {
  try {
    const body = await getText(client, submissionVerdictDetailKey(submissionId));
    const parsed: unknown = JSON.parse(body);
    return parsed;
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

export async function deleteSubmissionStorage(
  client: S3Client,
  submissionId: string,
): Promise<void> {
  await deleteBlobsByPrefix(client, submissionPrefix(submissionId));
}

export async function deleteSubmissionStaging(
  client: S3Client,
  submissionId: string,
): Promise<void> {
  await deleteBlobsByPrefix(client, submissionSourceStagingPrefix(submissionId));
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "NoSuchKey" || name === "NotFound";
}
