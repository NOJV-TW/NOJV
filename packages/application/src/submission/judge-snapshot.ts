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
import { getJudgeContext, getSubmissionSources } from "./queries";

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

export const judgeSnapshotSchema = z.object({
  format: z.literal(1),
  sandboxImage: z.string().min(1),
  submissionId: z.string(),
  problemGeneration: z.number().int(),
  draft: submissionJudgeDraftSchema,
  context: judgeContextSchema,
  sources: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
});
export type JudgeSnapshot = z.infer<typeof judgeSnapshotSchema>;

export async function prepareJudgeSnapshot(
  submissionId: string,
  draft: SubmissionJudgeDraft,
  sources?: SubmissionSource[],
): Promise<{ pointer: StorageObjectPointer; problemGeneration: number }> {
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
  const snapshot = judgeSnapshotSchema.parse({
    format: 1,
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

  return { pointer, problemGeneration: before.storageGeneration };
}

export async function readJudgeSnapshot(pointer: unknown): Promise<JudgeSnapshot> {
  const result = judgeSnapshotSchema.safeParse(
    JSON.parse(await getVerifiedText(storage(), assertStorageObjectPointer(pointer))),
  );
  if (!result.success) throw new IntegrityError("Invalid immutable judge snapshot.");
  return result.data;
}
