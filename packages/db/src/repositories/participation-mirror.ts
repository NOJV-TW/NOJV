import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type WriteClient = Pick<TransactionClient, "participation">;

export interface ParticipationMirrorSource {
  type: "contest" | "exam" | "virtual";
  userId: string;
  contestId?: string | null;
  examId?: string | null;
  score: number;
  penaltySeconds: number;
  subtaskScores: Prisma.InputJsonValue | null;
  status: string;
  startedAt: Date | null;
  submittedAt: Date | null;
  typeData?: Prisma.InputJsonValue | null;
}

function snapshotFields(source: ParticipationMirrorSource) {
  return {
    score: source.score,
    penaltySeconds: source.penaltySeconds,
    status: source.status,
    startedAt: source.startedAt,
    submittedAt: source.submittedAt,
    ...(source.subtaskScores != null ? { subtaskScores: source.subtaskScores } : {}),
    ...(source.typeData != null ? { typeData: source.typeData } : {}),
  };
}

// Find-or-create (not upsert): a user may hold both a contest and a virtual
// participation for the same contestId, so the key is type + context FK.
export async function mirrorParticipation(
  client: WriteClient,
  source: ParticipationMirrorSource,
): Promise<void> {
  const existing = await client.participation.findFirst({
    where: {
      type: source.type,
      userId: source.userId,
      contestId: source.contestId ?? null,
      examId: source.examId ?? null,
    },
    select: { id: true },
  });

  if (existing) {
    await client.participation.update({
      where: { id: existing.id },
      data: snapshotFields(source),
    });
    return;
  }

  await client.participation.create({
    data: {
      type: source.type,
      userId: source.userId,
      contestId: source.contestId ?? null,
      examId: source.examId ?? null,
      ...snapshotFields(source),
    },
  });
}

export interface ParticipationScoreKey {
  type: "contest" | "exam" | "virtual";
  userId: string;
  contestId?: string | null;
  examId?: string | null;
}

// Stage 3 score dual-write: mirror a recomputed score onto the Participation
// row. updateMany is a no-op when the row is absent, so it stays safe before
// the backfill has populated every row.
export async function mirrorParticipationScore(
  key: ParticipationScoreKey,
  fields: { score: number; penaltySeconds?: number; subtaskScores?: Record<string, number> },
): Promise<void> {
  await prisma.participation.updateMany({
    where: {
      type: key.type,
      userId: key.userId,
      contestId: key.contestId ?? null,
      examId: key.examId ?? null,
    },
    data: {
      score: fields.score,
      ...(fields.penaltySeconds !== undefined ? { penaltySeconds: fields.penaltySeconds } : {}),
      ...(fields.subtaskScores !== undefined ? { subtaskScores: fields.subtaskScores } : {}),
    },
  });
}

export async function backfillParticipation(): Promise<{
  contest: number;
  exam: number;
  virtual: number;
}> {
  const contests = await prisma.contestParticipation.findMany();
  for (const p of contests) {
    await mirrorParticipation(prisma, {
      type: "contest",
      userId: p.userId,
      contestId: p.contestId,
      score: p.score,
      penaltySeconds: p.penaltySeconds,
      subtaskScores: p.subtaskScores,
      status: p.status,
      startedAt: p.startedAt,
      submittedAt: p.submittedAt,
    });
  }

  const exams = await prisma.examParticipation.findMany();
  for (const p of exams) {
    await mirrorParticipation(prisma, {
      type: "exam",
      userId: p.userId,
      examId: p.examId,
      score: p.score,
      penaltySeconds: p.penaltySeconds,
      subtaskScores: p.subtaskScores,
      status: p.status,
      startedAt: p.startedAt,
      submittedAt: p.submittedAt,
      typeData: {
        ipPin: p.ipPin,
        ipGateExemptUntil: p.ipGateExemptUntil?.toISOString() ?? null,
        disqualifiedAt: p.disqualifiedAt?.toISOString() ?? null,
        registeredAt: p.registeredAt.toISOString(),
      },
    });
  }

  const virtuals = await prisma.virtualContest.findMany();
  for (const p of virtuals) {
    await mirrorParticipation(prisma, {
      type: "virtual",
      userId: p.userId,
      contestId: p.contestId,
      score: p.score,
      penaltySeconds: p.penaltySeconds,
      subtaskScores: p.subtaskScores,
      status: p.status,
      startedAt: p.startedAt,
      submittedAt: null,
      typeData: { endsAt: p.endsAt.toISOString() },
    });
  }

  return { contest: contests.length, exam: exams.length, virtual: virtuals.length };
}

export interface ReconcileReport {
  contest: { total: number; missing: number; scoreMismatch: number };
  exam: { total: number; missing: number; scoreMismatch: number };
  virtual: { total: number; missing: number };
  ok: boolean;
}

// Stage 4 gate: read-only check that the Participation mirror matches the legacy
// tables before any read is switched over. virtual score is intentionally not
// dual-written (it is recomputed on read), so virtual is checked by presence only.
export async function reconcileParticipation(): Promise<ReconcileReport> {
  const contests = await prisma.contestParticipation.findMany({
    select: { contestId: true, userId: true, score: true },
  });
  let cMissing = 0;
  let cMismatch = 0;
  for (const p of contests) {
    const m = await prisma.participation.findFirst({
      where: { type: "contest", contestId: p.contestId, userId: p.userId },
      select: { score: true },
    });
    if (!m) cMissing++;
    else if (m.score !== p.score) cMismatch++;
  }

  const exams = await prisma.examParticipation.findMany({
    select: { examId: true, userId: true, score: true },
  });
  let eMissing = 0;
  let eMismatch = 0;
  for (const p of exams) {
    const m = await prisma.participation.findFirst({
      where: { type: "exam", examId: p.examId, userId: p.userId },
      select: { score: true },
    });
    if (!m) eMissing++;
    else if (m.score !== p.score) eMismatch++;
  }

  const virtuals = await prisma.virtualContest.findMany({
    select: { contestId: true, userId: true },
  });
  let vMissing = 0;
  for (const p of virtuals) {
    const m = await prisma.participation.findFirst({
      where: { type: "virtual", contestId: p.contestId, userId: p.userId },
      select: { id: true },
    });
    if (!m) vMissing++;
  }

  return {
    contest: { total: contests.length, missing: cMissing, scoreMismatch: cMismatch },
    exam: { total: exams.length, missing: eMissing, scoreMismatch: eMismatch },
    virtual: { total: virtuals.length, missing: vMissing },
    ok: cMissing + cMismatch + eMissing + eMismatch + vMissing === 0,
  };
}
