import type { S3Client } from "@aws-sdk/client-s3";

import { deleteBlobsByPrefix, getText, listByPrefix, putText } from "./blobs";
import {
  submissionPrefix,
  submissionSourceKey,
  submissionSourcePrefix,
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

export async function getVerdictDetail<T>(
  client: S3Client,
  submissionId: string,
): Promise<T | null> {
  try {
    const body = await getText(client, submissionVerdictDetailKey(submissionId));
    return JSON.parse(body) as T;
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

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "NoSuchKey" || name === "NotFound";
}
