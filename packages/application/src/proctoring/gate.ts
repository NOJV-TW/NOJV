import {
  contestRepo,
  courseMembershipRepo,
  courseRepo,
  examRepo,
  participationRepo,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";

import { checkIpLock, type IpCheckResult } from "../shared/ip";

export type ProctoringEntityKind = "exam" | "contest";

export type ProctoringVerdict =
  { ok: true } | { ok: false; reason: ProctoringDenialReason; redirect?: string };

export type ProctoringDenialReason =
  | "not_found"
  | "not_published"
  | "not_enrolled"
  | "course_archived"
  | "not_started"
  | "ended"
  | "ip_whitelist"
  | "ip_binding";

export interface ProctoringGateInput {
  entityKind: ProctoringEntityKind;
  entityId: string;
  userId: string;
  ip?: string | null;
  now?: Date;
  startGraceMs?: number;
}

export async function checkProctoringGate(
  input: ProctoringGateInput,
): Promise<ProctoringVerdict> {
  return runTransaction((tx) => checkProctoringGateInTx(tx, input));
}

export async function checkProctoringGateInTx(
  tx: TransactionClient,
  input: ProctoringGateInput,
): Promise<ProctoringVerdict> {
  const now = input.now ?? new Date();
  const grace = input.startGraceMs ?? 0;

  if (input.entityKind === "contest") {
    return checkContestGate(tx, input, now, grace);
  }
  return checkExamGate(tx, input, now, grace);
}

async function checkContestGate(
  tx: TransactionClient,
  input: ProctoringGateInput,
  now: Date,
  grace: number,
): Promise<ProctoringVerdict> {
  const contest = await contestRepo.withTx(tx).findById(input.entityId);
  if (!contest) return { ok: false, reason: "not_found" };
  if (contest.visibility !== "published") {
    return { ok: false, reason: "not_published" };
  }

  if (now.getTime() < contest.startsAt.getTime() - grace) {
    return { ok: false, reason: "not_started" };
  }
  if (now.getTime() >= contest.endsAt.getTime()) {
    return { ok: false, reason: "ended" };
  }

  return { ok: true };
}

async function checkExamGate(
  tx: TransactionClient,
  input: ProctoringGateInput,
  now: Date,
  grace: number,
): Promise<ProctoringVerdict> {
  const exam = await examRepo.withTx(tx).findById(input.entityId);
  if (!exam) return { ok: false, reason: "not_found" };
  if (exam.status !== "published") return { ok: false, reason: "not_published" };

  const [membership, course] = await Promise.all([
    courseMembershipRepo.withTx(tx).findByComposite(exam.courseId, input.userId),
    courseRepo.withTx(tx).findArchivedById(exam.courseId),
  ]);

  if (membership?.status !== "active") {
    return { ok: false, reason: "not_enrolled" };
  }
  if (course?.archived) {
    return { ok: false, reason: "course_archived" };
  }

  if (now.getTime() < exam.startsAt.getTime() - grace) {
    return { ok: false, reason: "not_started" };
  }
  if (now.getTime() >= exam.endsAt.getTime()) {
    return { ok: false, reason: "ended" };
  }

  if (input.ip) {
    const participation = await participationRepo
      .withTx(tx)
      .findExamIpPin(input.entityId, input.userId);

    const ipResult: IpCheckResult = await checkIpLock(
      tx,
      {
        ipBindingEnabled: exam.ipBindingEnabled,
        ipViolationMode: exam.ipViolationMode,
        ipWhitelist: exam.ipWhitelist,
        ipWhitelistEnabled: exam.ipWhitelistEnabled,
      },
      input.ip,
      participation,
      { userId: input.userId, examId: input.entityId },
      now,
    );

    if (!ipResult.allowed) {
      return {
        ok: false,
        reason: ipResult.violationType === "whitelist" ? "ip_whitelist" : "ip_binding",
      };
    }
  }

  return { ok: true };
}
