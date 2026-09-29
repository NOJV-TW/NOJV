import { createHash, randomUUID } from "node:crypto";

import { prismaAdapterClient as db } from "@nojv/db";
import {
  assertStorageObjectPointer,
  getVerifiedText,
  putImmutableObject,
  putObjectIfAbsent,
  storagePointerFor,
  type StorageObjectPointer,
} from "@nojv/storage";

import { storage } from "../shared/storage-singleton";
import {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
} from "../shared/storage-object-lifecycle";
import { IntegrityError } from "../shared/errors";
import {
  judgeSnapshotSchema,
  pinnedJudgeSnapshotSchema,
  pinnedObjects,
  type JudgeSnapshot,
  type PinnedJudgeSnapshot,
} from "./judge-snapshot";

const TERMINAL_STATES = ["completed", "cancelled"];

export type JudgeSnapshotCompaction =
  | { outcome: "skipped_active" | "skipped_changed" | "already_compact" }
  | { outcome: "compacted" | "would_compact"; freedBytes: number; uploads: number };

export async function listCompactionCandidates(input: {
  limit: number;
  minBytes: number;
}): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "JudgeExecution"
    WHERE state = ANY(${TERMINAL_STATES})
      AND "leaseToken" IS NULL
      AND ("snapshot" ->> 'size')::bigint > ${input.minBytes}
    ORDER BY "createdAt", id
    LIMIT ${input.limit}
  `;
  return rows.map(({ id }) => id);
}

function isActive(execution: { state: string; leaseToken: string | null }): boolean {
  return !TERMINAL_STATES.includes(execution.state) || execution.leaseToken !== null;
}

async function currentProblemObjects(
  problemId: string,
): Promise<Map<string, StorageObjectPointer>> {
  const testcases = await db.testcase.findMany({
    where: { testcaseSet: { problemId } },
    select: { inputStorage: true, outputStorage: true, inputFileStorage: true },
  });
  const pointers = testcases.flatMap(({ inputStorage, outputStorage, inputFileStorage }) =>
    [
      inputStorage,
      outputStorage,
      ...Object.values((inputFileStorage ?? {}) as Record<string, unknown>),
    ]
      .filter((pointer) => pointer !== null)
      .map(assertStorageObjectPointer),
  );
  return new Map(
    pointers.map((pointer) => [`${pointer.sha256}:${String(pointer.size)}`, pointer]),
  );
}

function pinSnapshot(
  snapshot: JudgeSnapshot,
  existing: Map<string, StorageObjectPointer>,
): { pinned: PinnedJudgeSnapshot; uploads: Map<string, Buffer> } {
  const uploads = new Map<string, Buffer>();
  const pin = (content: string): StorageObjectPointer => {
    const body = Buffer.from(content, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const reused = existing.get(`${sha256}:${String(body.byteLength)}`);
    if (reused) return reused;
    const key = `problems/${snapshot.draft.problemId}/pinned-testcases/${sha256}`;
    uploads.set(key, body);
    return { key, sha256, size: body.byteLength };
  };
  const pinned = pinnedJudgeSnapshotSchema.parse({
    ...snapshot,
    format: 2,
    context: {
      ...snapshot.context,
      testcaseSets: snapshot.context.testcaseSets.map((set) => ({
        ...set,
        testcases: set.testcases.map(({ id, weight, input, output, inputFiles }) => ({
          id,
          weight,
          input: pin(input),
          ...(output !== undefined ? { output: pin(output) } : {}),
          ...(inputFiles
            ? {
                inputFiles: Object.fromEntries(
                  Object.entries(inputFiles).map(([name, content]) => [name, pin(content)]),
                ),
              }
            : {}),
        })),
      })),
    },
  });
  return { pinned, uploads };
}

export async function compactJudgeSnapshot(
  executionId: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<JudgeSnapshotCompaction> {
  const execution = await db.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
  if (isActive(execution)) return { outcome: "skipped_active" };
  const legacyPointer = assertStorageObjectPointer(execution.snapshot);
  const client = storage();
  const raw = JSON.parse(await getVerifiedText(client, legacyPointer)) as { format?: unknown };
  if (raw.format === 2) return { outcome: "already_compact" };
  const legacy = judgeSnapshotSchema.safeParse(raw);
  if (!legacy.success) throw new IntegrityError("Invalid immutable judge snapshot.");

  const { pinned, uploads } = pinSnapshot(
    legacy.data,
    await currentProblemObjects(legacy.data.draft.problemId),
  );
  const body = Buffer.from(JSON.stringify(pinned));
  const report = { freedBytes: legacyPointer.size - body.byteLength, uploads: uploads.size };
  if (dryRun) return { outcome: "would_compact", ...report };

  const uploadPointers = [...uploads].map(([key, content]) => storagePointerFor(key, content));
  await guardStorageObjectWrites(uploadPointers);
  const created: StorageObjectPointer[] = [];
  for (const pointer of uploadPointers) {
    const content = uploads.get(pointer.key);
    if (!content) continue;
    const result = await putObjectIfAbsent(client, pointer.key, content, {
      contentType: "text/plain; charset=utf-8",
    });
    if (result.created) created.push(pointer);
  }
  const snapshotKey = `submissions/${execution.submissionId}/judge-snapshots/${randomUUID()}.json`;
  const snapshotPointer = storagePointerFor(snapshotKey, body);
  await guardStorageObjectWrites([snapshotPointer]);
  await putImmutableObject(client, snapshotKey, body, { contentType: "application/json" });

  const committed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JudgeExecution" WHERE id = ${executionId} FOR UPDATE`;
    const current = await tx.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
    if (
      isActive(current) ||
      assertStorageObjectPointer(current.snapshot).key !== legacyPointer.key
    )
      return false;
    await tx.judgeExecution.update({
      where: { id: executionId },
      data: { snapshot: snapshotPointer },
    });
    await tx.judgeExecutionObject.createMany({
      data: pinnedObjects(pinned).map(({ key, sha256, size }) => ({
        executionId,
        key,
        sha256,
        size,
      })),
      skipDuplicates: true,
    });
    await commitStoragePointerSwap(tx, {
      added: [snapshotPointer, ...created],
      removed: [legacyPointer],
    });
    return true;
  });
  return committed ? { outcome: "compacted", ...report } : { outcome: "skipped_changed" };
}
