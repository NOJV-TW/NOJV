import {
  contestRepo,
  courseMembershipRepo,
  examRepo,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";

import { checkIpLock, type IpCheckResult } from "../shared/ip";

/**
 * What entity this gate is checking. Both kinds share existence / visibility /
 * time-window semantics, but only `exam` has proctoring (page lock, IP
 * whitelist, IP binding). Contests are public CP events with no IP gating.
 */
export type ProctoringEntityKind = "exam" | "contest";

export type ProctoringVerdict =
  | { ok: true }
  | { ok: false; reason: ProctoringDenialReason; redirect?: string };

/**
 * Machine-readable reason codes so callers (route loaders, hooks) can map
 * to localized messages and redirect behaviour without parsing strings.
 */
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
  /** Optional — skip IP checks when not supplied (e.g. background jobs). Ignored for contests. */
  ip?: string | null;
  /** Override `new Date()` for deterministic tests. */
  now?: Date;
  /** Grace before startsAt during which access is permitted. Default 0. */
  startGraceMs?: number;
}

/**
 * Central proctoring gate. Covers:
 *   - existence + published visibility
 *   - course-membership + archival (exam only)
 *   - time window
 *   - IP whitelist + IP binding (exam only)
 */
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

  // Contests are public — no IP gating, no page lock.
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
    tx.course.findUnique({
      select: { archived: true },
      where: { id: exam.courseId },
    }),
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
    const participation = await tx.examParticipation.findUnique({
      select: { id: true, ipPin: true },
      where: { examId_userId: { examId: input.entityId, userId: input.userId } },
    });

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
