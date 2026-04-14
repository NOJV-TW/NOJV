-- Add ActiveExamSession + ExamSessionEvent for the Phase 4 exam lock.
--
-- One row per (user, exam) pair while the student is in-session. The
-- Phase 4 hook uses `endedAt IS NULL` to route students back to the
-- exam landing page on every navigation. `ipPin` snapshots the client
-- IP at session start for the Phase 4 IP binding check.
--
-- `ExamSessionEvent` is an append-only audit log: enter / leave /
-- visibility_lost / release / auto_close / heartbeat.
--
-- Pure DDL — no data migration needed. The Exam table was introduced
-- in 20260414050000_split_contest_into_exam_and_contest so the FKs
-- below resolve against the new table.

BEGIN;

-- ─── Enums ──────────────────────────────────────────────────────

CREATE TYPE "ExamSessionReleaseReason" AS ENUM (
  'submitted',
  'time_up',
  'released_by_instructor'
);

CREATE TYPE "ExamSessionEventType" AS ENUM (
  'enter',
  'leave',
  'visibility_lost',
  'release',
  'auto_close',
  'heartbeat'
);

-- ─── ActiveExamSession ──────────────────────────────────────────

CREATE TABLE "ActiveExamSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "releaseReason" "ExamSessionReleaseReason",
  "ipPin" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActiveExamSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActiveExamSession_userId_examId_key"
  ON "ActiveExamSession"("userId", "examId");
CREATE INDEX "ActiveExamSession_examId_endedAt_idx"
  ON "ActiveExamSession"("examId", "endedAt");
CREATE INDEX "ActiveExamSession_userId_endedAt_idx"
  ON "ActiveExamSession"("userId", "endedAt");

ALTER TABLE "ActiveExamSession"
  ADD CONSTRAINT "ActiveExamSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ActiveExamSession_examId_fkey"
    FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ExamSessionEvent ───────────────────────────────────────────

CREATE TABLE "ExamSessionEvent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "eventType" "ExamSessionEventType" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "ExamSessionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExamSessionEvent_sessionId_occurredAt_idx"
  ON "ExamSessionEvent"("sessionId", "occurredAt");

ALTER TABLE "ExamSessionEvent"
  ADD CONSTRAINT "ExamSessionEvent_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "ActiveExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
