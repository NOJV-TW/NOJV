-- Revert contest proctoring (added in 20260416200000_contest_proctoring).
--
-- Product decision: contests are public / invite-only CP events — they don't
-- do IP binding, IP whitelist, or page lock. Only `Exam` carries proctoring.
-- Leaving the columns in place with `Enabled=false` defaults was clean on
-- paper but created confusion in the admin UI ("why is a contest asking me
-- about IP binding?") and duplicated the mental model; the only reason IP
-- was on Contest was a failed Phase-3 parity attempt.
--
-- Order matters: we touch IpViolationLog before Contest/ContestParticipation
-- so the FK is gone before we drop the target column.

-- 1. Delete any violation rows tied to contests (or orphaned from earlier
--    transitional state where examId was nullable). These rows become
--    meaningless once Contest has no proctoring config to violate.
DELETE FROM "IpViolationLog" WHERE "contestId" IS NOT NULL OR "examId" IS NULL;

-- 2. Drop the contestId index + FK + column
DROP INDEX IF EXISTS "IpViolationLog_contestId_createdAt_idx";

ALTER TABLE "IpViolationLog"
    DROP CONSTRAINT IF EXISTS "IpViolationLog_contestId_fkey";

ALTER TABLE "IpViolationLog"
    DROP COLUMN "contestId";

-- 3. Restore examId as NOT NULL (safe now that all non-exam rows are gone)
ALTER TABLE "IpViolationLog"
    ALTER COLUMN "examId" SET NOT NULL;

-- 4. Drop ipPin from ContestParticipation
ALTER TABLE "ContestParticipation"
    DROP COLUMN "ipPin";

-- 5. Drop the five proctoring columns from Contest
ALTER TABLE "Contest"
    DROP COLUMN "pageLockEnabled",
    DROP COLUMN "ipWhitelistEnabled",
    DROP COLUMN "ipBindingEnabled",
    DROP COLUMN "ipWhitelist",
    DROP COLUMN "ipViolationMode";
