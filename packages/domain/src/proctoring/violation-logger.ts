import { ipViolationLogRepo, type TransactionClient } from "@nojv/db";

/** Duplicated here (not imported from `./gate`) to keep the violation
 * logger importable from `shared/ip-utils.ts` without a circular dep. */
export type ProctoringEntityKind = "exam" | "contest";

export type ViolationType = "whitelist" | "binding";

export interface LogViolationInput {
  entityKind: ProctoringEntityKind;
  entityId: string;
  userId: string;
  expectedIp: string | null;
  actualIp: string;
  violationType: ViolationType;
}

/**
 * Write an `IpViolationLog` row for either an exam or a contest.
 *
 * Invariant (application-enforced): exactly one of `examId` / `contestId`
 * is set per row. The Prisma schema allows both columns to be null but
 * callers must always route through this helper.
 */
export async function logViolation(input: LogViolationInput) {
  return ipViolationLogRepo.create(buildCreateInput(input));
}

export async function logViolationInTx(tx: TransactionClient, input: LogViolationInput) {
  return ipViolationLogRepo.withTx(tx).create(buildCreateInput(input));
}

function buildCreateInput(input: LogViolationInput) {
  const base = {
    actualIp: input.actualIp,
    expectedIp: input.expectedIp,
    userId: input.userId,
    violationType: input.violationType
  };
  return input.entityKind === "exam"
    ? { ...base, examId: input.entityId }
    : { ...base, contestId: input.entityId };
}
