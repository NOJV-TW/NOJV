import { createHash } from "node:crypto";

import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
} from "@nojv/core";
import { durableWorkRepo, type TransactionClient } from "@nojv/db";
import { z } from "zod";

import { getDomainOrchestration } from "./orchestration";
import { toJsonValue } from "./to-json-value";

export const LIFECYCLE_CANCELLATION_WORK_KIND = "lifecycle.cancel";

const scheduleIdentity = {
  scheduleRevision: z.number().int().nonnegative(),
  timerFingerprint: z.string().min(1),
};
const assignmentInput = z
  .object({
    assignmentId: z.string().min(1),
    opensAt: z.iso.datetime(),
    closesAt: z.iso.datetime(),
    ...scheduleIdentity,
  })
  .strict();
const examInput = z
  .object({
    examId: z.string().min(1),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    ...scheduleIdentity,
  })
  .strict();
const contestInput = z
  .object({
    contestId: z.string().min(1),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    frozenAt: z.iso.datetime().nullable(),
    scoreboardMode: z.enum(["hidden", "live", "frozen"]),
    ...scheduleIdentity,
  })
  .strict();

export const lifecycleCancellationPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assignment"), input: assignmentInput }).strict(),
  z.object({ type: z.literal("exam"), input: examInput }).strict(),
  z.object({ type: z.literal("contest"), input: contestInput }).strict(),
]);

export type LifecycleCancellationPayload =
  | { type: "assignment"; input: AssignmentDueSoonInput }
  | { type: "exam"; input: ExamAutoCloseInput }
  | { type: "contest"; input: ContestLifecycleInput };

function dedupeKey(payload: LifecycleCancellationPayload): string {
  const input = payload.input;
  const entityId =
    payload.type === "assignment"
      ? payload.input.assignmentId
      : payload.type === "exam"
        ? payload.input.examId
        : payload.input.contestId;
  const identity = createHash("sha256")
    .update(`${String(input.scheduleRevision)}\0${input.timerFingerprint}`)
    .digest("hex");
  return `${payload.type}:${entityId}:${identity}`;
}

export async function enqueueLifecycleCancellation(
  tx: TransactionClient,
  rawPayload: LifecycleCancellationPayload,
): Promise<void> {
  const payload = lifecycleCancellationPayloadSchema.parse(rawPayload);
  await durableWorkRepo.withTx(tx).enqueue({
    kind: LIFECYCLE_CANCELLATION_WORK_KIND,
    dedupeKey: dedupeKey(payload),
    payload: toJsonValue(payload),
    maxAttempts: 20,
  });
}

export async function executeLifecycleCancellation(rawPayload: unknown): Promise<void> {
  const payload = lifecycleCancellationPayloadSchema.parse(rawPayload);
  const orchestration = getDomainOrchestration();
  switch (payload.type) {
    case "assignment":
      await orchestration.cancelAssignmentDueSoon(payload.input);
      break;
    case "exam":
      await orchestration.cancelExamAutoClose(payload.input);
      break;
    case "contest":
      await orchestration.cancelContestLifecycle(payload.input);
      break;
  }
}
