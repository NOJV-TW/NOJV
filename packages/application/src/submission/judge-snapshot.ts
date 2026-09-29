import { randomUUID } from "node:crypto";
import {
  adjustmentRulesSchema,
  advancedConfigSchema,
  compareOptionsSchema,
  judgeScriptLanguageSchema,
  judgeTypeSchema,
  problemJudgeTestcaseSchema,
  problemSampleSchema,
  problemTypeSchema,
  submissionJudgeDraftSchema,
  workspaceFileVisibilitySchema,
  type SubmissionJudgeDraft,
} from "@nojv/core";
import { prismaAdapterClient as db } from "@nojv/db";
import {
  assertStorageObjectPointer,
  getVerifiedText,
  putImmutableObject,
  storagePointerFor,
  type SubmissionSource,
  type StorageObjectPointer,
} from "@nojv/storage";
import { z } from "zod";
import { storage } from "../shared/storage-singleton";
import { guardStorageObjectWrites } from "../shared/storage-object-lifecycle";
import { ConflictError, IntegrityError } from "../shared/errors";
import { getSubmissionSources } from "./details";
import { getJudgeContext } from "./judge-context";

const judgeContextSchema = z.object({
  adjustment: z.object({
    adjustmentRules: adjustmentRulesSchema.nullable(),
    dueAt: z.coerce.date().nullable(),
    submittedAt: z.coerce.date(),
  }),
  checkerScript: z.string().nullable(),
  checkerLanguage: judgeScriptLanguageSchema.nullable(),
  interactorScript: z.string().nullable(),
  interactorLanguage: judgeScriptLanguageSchema.nullable(),
  compareOptions: compareOptionsSchema.nullable(),
  judgeType: judgeTypeSchema,
  runtime: z.object({
    timeLimitMs: z.number().positive(),
    memoryLimitMb: z.number().positive(),
    env: z.record(z.string(), z.string()),
  }),
  samples: z.array(problemSampleSchema),
  problemType: problemTypeSchema,
  testcaseSets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      weight: z.number(),
      testcases: z.array(problemJudgeTestcaseSchema),
    }),
  ),
  workspaceFiles: z.array(
    z.object({
      content: z.string(),
      language: z.string(),
      path: z.string(),
      visibility: workspaceFileVisibilitySchema,
    }),
  ),
  advanced: z
    .object({
      config: advancedConfigSchema,
      requiredPaths: z.array(z.string()),
      resourceLimits: z.object({ totalTimeMs: z.number(), memoryMb: z.number() }),
    })
    .nullable(),
});

const storagePointerSchema = z.object({
  key: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
});

const pinnedContextSchema = judgeContextSchema.extend({
  testcaseSets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      weight: z.number(),
      testcases: z.array(
        z.object({
          id: z.string(),
          weight: z.number(),
          input: storagePointerSchema,
          output: storagePointerSchema.optional(),
          inputFiles: z.record(z.string(), storagePointerSchema).optional(),
        }),
      ),
    }),
  ),
});

const snapshotFields = {
  sandboxImage: z.string().min(1),
  submissionId: z.string(),
  problemGeneration: z.number().int(),
  draft: submissionJudgeDraftSchema,
  sources: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
};

export const judgeSnapshotSchema = z.object({
  format: z.literal(1),
  context: judgeContextSchema,
  ...snapshotFields,
});
export type JudgeSnapshot = z.infer<typeof judgeSnapshotSchema>;

export const pinnedJudgeSnapshotSchema = z.object({
  format: z.literal(2),
  context: pinnedContextSchema,
  ...snapshotFields,
});
export type PinnedJudgeSnapshot = z.infer<typeof pinnedJudgeSnapshotSchema>;

const storedJudgeSnapshotSchema = z.discriminatedUnion("format", [
  judgeSnapshotSchema,
  pinnedJudgeSnapshotSchema,
]);

export function pinnedObjects(snapshot: PinnedJudgeSnapshot): StorageObjectPointer[] {
  const pointers = snapshot.context.testcaseSets.flatMap(({ testcases }) =>
    testcases.flatMap(({ input, output, inputFiles }) => [
      input,
      ...(output ? [output] : []),
      ...Object.values(inputFiles ?? {}),
    ]),
  );
  return [...new Map(pointers.map((pointer) => [pointer.key, pointer])).values()];
}

async function resolvePinnedSnapshot(snapshot: PinnedJudgeSnapshot): Promise<JudgeSnapshot> {
  const client = storage();
  const read = (pointer: StorageObjectPointer) => getVerifiedText(client, pointer);
  const testcaseSets = await Promise.all(
    snapshot.context.testcaseSets.map(async (set) => ({
      ...set,
      testcases: await Promise.all(
        set.testcases.map(async ({ id, weight, input, output, inputFiles }) => ({
          id,
          weight,
          input: await read(input),
          ...(output ? { output: await read(output) } : {}),
          ...(inputFiles
            ? {
                inputFiles: Object.fromEntries(
                  await Promise.all(
                    Object.entries(inputFiles).map(
                      async ([name, pointer]) => [name, await read(pointer)] as const,
                    ),
                  ),
                ),
              }
            : {}),
        })),
      ),
    })),
  );
  return { ...snapshot, format: 1, context: { ...snapshot.context, testcaseSets } };
}

export async function prepareJudgeSnapshot(
  submissionId: string,
  draft: SubmissionJudgeDraft,
  sources?: SubmissionSource[],
): Promise<{
  pointer: StorageObjectPointer;
  problemGeneration: number;
  pins: StorageObjectPointer[];
}> {
  const before = await db.problem.findUniqueOrThrow({
    where: { id: draft.problemId },
    select: { storageGeneration: true },
  });
  const [context, studentSources] = await Promise.all([
    getJudgeContext(submissionId),
    sources ?? getSubmissionSources(submissionId),
  ]);
  const after = await db.problem.findUniqueOrThrow({
    where: { id: draft.problemId },
    select: { storageGeneration: true },
  });
  if (before.storageGeneration !== after.storageGeneration)
    throw new ConflictError("Problem changed while pinning the judge version. Please retry.");
  const snapshot = pinnedJudgeSnapshotSchema.parse({
    format: 2,
    sandboxImage: process.env.SANDBOX_IMAGE,
    submissionId,
    problemGeneration: before.storageGeneration,
    draft,
    context,
    sources: studentSources,
  });
  const body = Buffer.from(JSON.stringify(snapshot));
  const key = `submissions/${submissionId}/judge-snapshots/${randomUUID()}.json`;
  const pointer = storagePointerFor(key, body);
  await guardStorageObjectWrites([pointer]);
  await putImmutableObject(storage(), key, body, { contentType: "application/json" });

  return {
    pointer,
    problemGeneration: before.storageGeneration,
    pins: pinnedObjects(snapshot),
  };
}

export async function readJudgeSnapshot(pointer: unknown): Promise<JudgeSnapshot> {
  const result = storedJudgeSnapshotSchema.safeParse(
    JSON.parse(await getVerifiedText(storage(), assertStorageObjectPointer(pointer))),
  );
  if (!result.success) throw new IntegrityError("Invalid immutable judge snapshot.");
  return result.data.format === 2 ? resolvePinnedSnapshot(result.data) : result.data;
}
