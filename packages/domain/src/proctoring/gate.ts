import {
  contestRepo,
  courseMembershipRepo,
  examRepo,
  runTransaction,
  type TransactionClient
} from "@nojv/db";

import { checkIpLock, type IpCheckResult } from "../shared/ip-utils";

import type { ProctoringEntityKind } from "./violation-logger";

export type { ProctoringEntityKind };

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
  /** Optional — skip IP checks when not supplied (e.g. background jobs). */
  ip?: string | null;
  /** Override `new Date()` for deterministic tests. */
  now?: Date;
  /** Grace before startsAt during which access is permitted. Default 0. */
  startGraceMs?: number;
}

interface ProctoringConfig {
  startsAt: Date;
  endsAt: Date;
  ipWhitelistEnabled: boolean;
  ipBindingEnabled: boolean;
  ipWhitelist: string[];
  ipViolationMode: string;
}

/**
 * Central proctoring gate shared by exam and contest layouts.
 *
 * Mirror of the logic scattered across `exam/session.ts` and
 * `hooks.server.ts`, but wired to take an entity kind so contests
 * (added in Phase 3 of the CUID unification) can reuse it.
 *
 * Behavior-preserving for exam: the checks below match what the
 * existing exam session code enforces. Contest path is new.
 */
export async function checkProctoringGate(
  input: ProctoringGateInput
): Promise<ProctoringVerdict> {
  return runTransaction((tx) => checkProctoringGateInTx(tx, input));
}

export async function checkProctoringGateInTx(
  tx: TransactionClient,
  input: ProctoringGateInput
): Promise<ProctoringVerdict> {
  const now = input.now ?? new Date();
  const grace = input.startGraceMs ?? 0;

  const resolved =
    input.entityKind === "exam"
      ? await resolveExam(tx, input.entityId, input.userId)
      : await resolveContest(tx, input.entityId);

  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  const { config, participation } = resolved;

  if (now.getTime() < config.startsAt.getTime() - grace) {
    return { ok: false, reason: "not_started" };
  }
  if (now.getTime() >= config.endsAt.getTime()) {
    return { ok: false, reason: "ended" };
  }

  if (input.ip) {
    const ipResult: IpCheckResult = await checkIpLock(
      tx,
      {
        ipBindingEnabled: config.ipBindingEnabled,
        ipViolationMode: config.ipViolationMode,
        ipWhitelist: config.ipWhitelist,
        ipWhitelistEnabled: config.ipWhitelistEnabled
      },
      input.ip,
      participation,
      {
        scope:
          input.entityKind === "exam"
            ? { kind: "exam", examId: input.entityId }
            : { kind: "contest", contestId: input.entityId },
        userId: input.userId
      }
    );

    if (!ipResult.allowed) {
      return {
        ok: false,
        reason: ipResult.violationType === "whitelist" ? "ip_whitelist" : "ip_binding"
      };
    }
  }

  return { ok: true };
}

type ResolveResult =
  | {
      ok: true;
      config: ProctoringConfig;
      participation: { id: string; ipPin: string | null } | null;
    }
  | { ok: false; reason: ProctoringDenialReason };

async function resolveExam(
  tx: TransactionClient,
  examId: string,
  userId: string
): Promise<ResolveResult> {
  const exam = await examRepo.withTx(tx).findById(examId);
  if (!exam) return { ok: false, reason: "not_found" };
  if (exam.status !== "published") return { ok: false, reason: "not_published" };

  const [membership, course] = await Promise.all([
    courseMembershipRepo.withTx(tx).findByComposite(exam.courseId, userId),
    tx.course.findUnique({
      select: { archived: true },
      where: { id: exam.courseId }
    })
  ]);

  if (membership?.status !== "active") {
    return { ok: false, reason: "not_enrolled" };
  }
  if (course?.archived) {
    return { ok: false, reason: "course_archived" };
  }

  const participation = await tx.examParticipation.findUnique({
    select: { id: true, ipPin: true },
    where: { examId_userId: { examId, userId } }
  });

  return {
    ok: true,
    config: {
      endsAt: exam.endsAt,
      ipBindingEnabled: exam.ipBindingEnabled,
      ipViolationMode: exam.ipViolationMode,
      ipWhitelist: exam.ipWhitelist,
      ipWhitelistEnabled: exam.ipWhitelistEnabled,
      startsAt: exam.startsAt
    },
    participation: participation ? { ipPin: participation.ipPin, id: participation.id } : null
  };
}

async function resolveContest(
  tx: TransactionClient,
  contestId: string
): Promise<ResolveResult> {
  const contest = await contestRepo.withTx(tx).findById(contestId);
  if (!contest) return { ok: false, reason: "not_found" };
  if (contest.visibility !== "published") {
    return { ok: false, reason: "not_published" };
  }

  // Contests don't gate on course membership — participation is open
  // by design, invitation is via `inviteCode` handled elsewhere.
  // `participation` for IP binding is looked up lazily below.

  return {
    ok: true,
    config: {
      endsAt: contest.endsAt,
      ipBindingEnabled: contest.ipBindingEnabled,
      ipViolationMode: contest.ipViolationMode,
      ipWhitelist: contest.ipWhitelist,
      ipWhitelistEnabled: contest.ipWhitelistEnabled,
      startsAt: contest.startsAt
    },
    participation: null
  };
}
