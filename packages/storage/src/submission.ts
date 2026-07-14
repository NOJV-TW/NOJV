import type { S3Client } from "@aws-sdk/client-s3";
import { parseRelativePath } from "@nojv/core";

import {
  StorageIntegrityError,
  assertStorageObjectPointer,
  getVerifiedText,
  putImmutableObject,
  putImmutableText,
  storagePointerFor,
  type StorageObjectPointer,
} from "./object";
import {
  submissionSourceKey,
  submissionSourceManifestKey,
  submissionVerdictDetailKey,
} from "./keys";

export interface SubmissionSource {
  path: string;
  content: string;
}

interface PlannedSubmissionSource extends SubmissionSource {
  pointer: StorageObjectPointer;
}

export interface SubmissionSourcePlan {
  sources: readonly PlannedSubmissionSource[];
  manifest: StorageObjectPointer;
  manifestBody: Buffer;
  pointers: readonly StorageObjectPointer[];
}

export interface SubmissionSourceManifest {
  version: 1;
  sources: { path: string; object: StorageObjectPointer }[];
}

export function planSubmissionSources(
  submissionId: string,
  generation: string,
  sources: readonly SubmissionSource[],
): SubmissionSourcePlan {
  const seen = new Set<string>();
  const planned = sources.map((source) => {
    const path = parseRelativePath(source.path);
    if (seen.has(path)) throw new Error(`Duplicate submission source path: ${path}`);
    seen.add(path);
    const body = Buffer.from(source.content, "utf8");
    return {
      path,
      content: source.content,
      pointer: storagePointerFor(submissionSourceKey(submissionId, generation, path), body),
    };
  });
  const manifestValue: SubmissionSourceManifest = {
    version: 1,
    sources: planned.map(({ path, pointer }) => ({ path, object: pointer })),
  };
  const manifestBody = Buffer.from(JSON.stringify(manifestValue), "utf8");
  const manifest = storagePointerFor(
    submissionSourceManifestKey(submissionId, generation),
    manifestBody,
  );
  return {
    sources: planned,
    manifest,
    manifestBody,
    pointers: [...planned.map(({ pointer }) => pointer), manifest],
  };
}

export async function putSubmissionSourcePlan(
  client: S3Client,
  plan: SubmissionSourcePlan,
): Promise<StorageObjectPointer> {
  await Promise.all(
    plan.sources.map(({ content, pointer }) =>
      putImmutableText(client, pointer.key, content),
    ),
  );
  await putImmutableObject(client, plan.manifest.key, plan.manifestBody, {
    contentType: "application/json",
  });
  return plan.manifest;
}

export async function putSubmissionSources(
  client: S3Client,
  submissionId: string,
  generation: string,
  sources: readonly SubmissionSource[],
): Promise<StorageObjectPointer> {
  return putSubmissionSourcePlan(
    client,
    planSubmissionSources(submissionId, generation, sources),
  );
}

function parseManifest(raw: string, key: string): SubmissionSourceManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new StorageIntegrityError(key, "source manifest is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StorageIntegrityError(key, "source manifest is not an object");
  }
  const record = value as { version?: unknown; sources?: unknown };
  if (record.version !== 1 || !Array.isArray(record.sources)) {
    throw new StorageIntegrityError(key, "source manifest version is unsupported");
  }
  const seen = new Set<string>();
  const sources = record.sources.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new StorageIntegrityError(key, "source manifest entry is malformed");
    }
    const candidate = entry as { path?: unknown; object?: unknown };
    if (typeof candidate.path !== "string") {
      throw new StorageIntegrityError(key, "source manifest path is missing");
    }
    let path: string;
    try {
      path = parseRelativePath(candidate.path);
    } catch {
      throw new StorageIntegrityError(key, "source manifest path is unsafe");
    }
    if (seen.has(path)) {
      throw new StorageIntegrityError(key, `source manifest path is duplicated: ${path}`);
    }
    seen.add(path);
    return { path, object: assertStorageObjectPointer(candidate.object) };
  });
  return { version: 1, sources };
}

export async function getSubmissionSources(
  client: S3Client,
  manifestPointer: StorageObjectPointer,
): Promise<SubmissionSource[]> {
  const pointer = assertStorageObjectPointer(manifestPointer);
  const manifest = parseManifest(await getVerifiedText(client, pointer), pointer.key);
  const sources = await Promise.all(
    manifest.sources.map(async ({ path, object }) => ({
      path,
      content: await getVerifiedText(client, object),
    })),
  );
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}

export async function getSubmissionSourcePointers(
  client: S3Client,
  manifestPointer: StorageObjectPointer,
): Promise<StorageObjectPointer[]> {
  const pointer = assertStorageObjectPointer(manifestPointer);
  const manifest = parseManifest(await getVerifiedText(client, pointer), pointer.key);
  return manifest.sources.map(({ object }) => object);
}

export function putVerdictDetail(
  client: S3Client,
  submissionId: string,
  judgeRunId: string,
  detail: unknown,
): Promise<StorageObjectPointer> {
  return putImmutableObject(
    client,
    submissionVerdictDetailKey(submissionId, judgeRunId),
    Buffer.from(JSON.stringify(detail), "utf8"),
    { contentType: "application/json" },
  );
}

export async function getVerdictDetail(
  client: S3Client,
  pointer: StorageObjectPointer,
): Promise<unknown> {
  const verifiedPointer = assertStorageObjectPointer(pointer);
  const body = await getVerifiedText(client, verifiedPointer);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new StorageIntegrityError(verifiedPointer.key, "verdict detail is not valid JSON");
  }
}
