import { createHash } from "node:crypto";

import {
  DurableWorkInvariantError,
  durableWorkRepo,
  prismaAdapterClient,
  type Prisma,
  type TransactionClient,
} from "@nojv/db";
import {
  assertStorageObjectPointer,
  deleteBlob,
  getSubmissionSourcePointers,
  getVerifiedObject,
  isStorageObjectNotFoundError,
  type StorageObjectPointer,
} from "@nojv/storage";

import { storage } from "./storage-singleton";

export const STORAGE_OBJECT_CLEANUP_KIND = "storage.object.cleanup";
const READER_GRACE_MS = 60 * 60 * 1_000;

export interface StorageObjectCleanupPayload {
  [key: string]: Prisma.InputJsonValue;
  pointer: StorageObjectPointer;
}

function cleanupDedupeKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function cleanupInput(pointer: StorageObjectPointer, availableAt: Date) {
  return {
    kind: STORAGE_OBJECT_CLEANUP_KIND,
    dedupeKey: cleanupDedupeKey(pointer.key),
    payload: { pointer } satisfies StorageObjectCleanupPayload,
    availableAt,
    maxAttempts: 20,
  };
}

function uniquePointers(pointers: readonly StorageObjectPointer[]): StorageObjectPointer[] {
  return [...new Map(pointers.map((pointer) => [pointer.key, pointer])).values()];
}

export async function guardStorageObjectWrites(
  pointers: readonly StorageObjectPointer[],
  now = new Date(),
): Promise<void> {
  const unique = uniquePointers(pointers);
  if (unique.length === 0) return;
  const availableAt = new Date(now.getTime() + READER_GRACE_MS);
  await durableWorkRepo.enqueueMany(
    unique.map((pointer) => cleanupInput(pointer, availableAt)),
  );
}

export async function commitStoragePointerSwap(
  tx: TransactionClient,
  input: {
    added: readonly StorageObjectPointer[];
    removed?: readonly StorageObjectPointer[];
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const repo = durableWorkRepo.withTx(tx);
  const addedKeys = new Set(input.added.map(({ key }) => key));
  for (const pointer of uniquePointers(input.added)) {
    const cancelled = await repo.cancel({
      kind: STORAGE_OBJECT_CLEANUP_KIND,
      dedupeKey: cleanupDedupeKey(pointer.key),
      now,
    });
    if (!cancelled) {
      throw new Error(`Storage write guard is not cancellable for ${pointer.key}`);
    }
  }

  const availableAt = new Date(now.getTime() + READER_GRACE_MS);
  for (const pointer of uniquePointers(input.removed ?? []).filter(
    ({ key }) => !addedKeys.has(key),
  )) {
    const work = cleanupInput(pointer, availableAt);
    const existing = await tx.durableWork.findUnique({
      where: {
        kind_dedupeKey: { kind: work.kind, dedupeKey: work.dedupeKey },
      },
    });
    if (!existing) {
      await repo.enqueue(work);
      continue;
    }
    const persisted = parseStorageObjectCleanupPayload(existing.payload).pointer;
    if (
      persisted.key !== pointer.key ||
      persisted.sha256 !== pointer.sha256 ||
      persisted.size !== pointer.size
    ) {
      throw new DurableWorkInvariantError(work.kind, work.dedupeKey, "pointer differs");
    }
    if (existing.status === "pending") {
      await repo.reschedule({
        kind: work.kind,
        dedupeKey: work.dedupeKey,
        availableAt,
        now,
      });
    } else if (existing.status !== "leased") {
      await repo.reactivate(cleanupInput(pointer, existing.availableAt));
      await repo.reschedule({
        kind: work.kind,
        dedupeKey: work.dedupeKey,
        availableAt,
        now,
      });
    }
  }
}

export function parseStorageObjectCleanupPayload(value: unknown): StorageObjectCleanupPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Storage cleanup payload must be an object.");
  }
  return { pointer: assertStorageObjectPointer((value as { pointer?: unknown }).pointer) };
}

export async function cleanupUnreferencedStorageObject(rawPayload: unknown): Promise<void> {
  const { pointer } = parseStorageObjectCleanupPayload(rawPayload);
  if (await storageObjectIsReferenced(pointer.key)) return;

  const client = storage();
  const isSourceManifest =
    pointer.key.endsWith("/manifest.json") && pointer.key.includes("/source-generations/");
  if (!isSourceManifest) {
    try {
      await getVerifiedObject(client, pointer);
    } catch (reason) {
      if (isStorageObjectNotFoundError(reason)) return;
      throw reason;
    }
    await deleteBlob(client, pointer.key);
    return;
  }

  let childPointers: StorageObjectPointer[];
  try {
    childPointers = await getSubmissionSourcePointers(client, pointer);
  } catch (reason) {
    if (isStorageObjectNotFoundError(reason)) return;
    throw reason;
  }

  const presentChildren: StorageObjectPointer[] = [];
  for (const child of childPointers) {
    try {
      await getVerifiedObject(client, child);
      presentChildren.push(child);
    } catch (reason) {
      if (!isStorageObjectNotFoundError(reason)) throw reason;
    }
  }
  for (const child of presentChildren) await deleteBlob(client, child.key);
  await deleteBlob(client, pointer.key);
}

async function storageObjectIsReferenced(key: string): Promise<boolean> {
  const [row] = await prismaAdapterClient.$queryRaw<{ referenced: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "Problem"
      WHERE "checkerStorage" ->> 'key' = ${key}
         OR "interactorStorage" ->> 'key' = ${key}
      UNION ALL
      SELECT 1 FROM "Testcase"
      WHERE "inputStorage" ->> 'key' = ${key}
         OR "outputStorage" ->> 'key' = ${key}
         OR EXISTS (
           SELECT 1 FROM jsonb_each(COALESCE("inputFileStorage", '{}'::jsonb)) entry
           WHERE entry.value ->> 'key' = ${key}
         )
      UNION ALL
      SELECT 1 FROM "ProblemWorkspaceFile"
      WHERE "contentStorage" ->> 'key' = ${key}
      UNION ALL
      SELECT 1 FROM "Submission"
      WHERE "sourceStorage" ->> 'key' = ${key}
         OR "verdictDetailStorage" ->> 'key' = ${key}
    ) AS referenced
  `;
  return row?.referenced === true;
}
