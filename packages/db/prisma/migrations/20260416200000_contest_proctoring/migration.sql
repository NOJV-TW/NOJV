-- Phase 3 of the CUID URL unification: contest proctoring parity.
--   * Add Exam-style proctoring fields to Contest.
--   * Add `ipPin` to ContestParticipation (mirrors ExamParticipation).
--   * Make IpViolationLog.examId nullable and add a nullable contestId FK
--     so violations from standalone contests land in the same log.
--   * The invariant (exactly one of examId / contestId set) is enforced
--     by the shared proctoring helper, not by a CHECK constraint.

-- Contest proctoring columns ----------------------------------------------
ALTER TABLE "Contest"
    ADD COLUMN "pageLockEnabled"    BOOLEAN           NOT NULL DEFAULT false,
    ADD COLUMN "ipWhitelistEnabled" BOOLEAN           NOT NULL DEFAULT false,
    ADD COLUMN "ipBindingEnabled"   BOOLEAN           NOT NULL DEFAULT false,
    ADD COLUMN "ipWhitelist"        TEXT[]                     DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "ipViolationMode"    "IpViolationMode" NOT NULL DEFAULT 'block';

-- ContestParticipation ipPin parity with ExamParticipation ----------------
ALTER TABLE "ContestParticipation"
    ADD COLUMN "ipPin" TEXT;

-- IpViolationLog: broaden to accept contest rows --------------------------
ALTER TABLE "IpViolationLog"
    ALTER COLUMN "examId" DROP NOT NULL;

ALTER TABLE "IpViolationLog"
    ADD COLUMN "contestId" TEXT;

ALTER TABLE "IpViolationLog"
    ADD CONSTRAINT "IpViolationLog_contestId_fkey"
    FOREIGN KEY ("contestId") REFERENCES "Contest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "IpViolationLog_contestId_createdAt_idx"
    ON "IpViolationLog"("contestId", "createdAt");
