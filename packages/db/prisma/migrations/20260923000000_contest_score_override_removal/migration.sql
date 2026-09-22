-- expand-contract-ok: contests no longer take score overrides. Production holds no ScoreOverride rows and the release runs inside the migration maintenance window, so the contest enum value and the user-subject column leave in one step.
DELETE FROM "ScoreOverrideAuditLog" WHERE "contextType" = 'contest';
DELETE FROM "ScoreOverride" WHERE "contextType" = 'contest';

ALTER TABLE "ScoreOverride" DROP CONSTRAINT "ScoreOverride_subject_chk";
DROP INDEX "ScoreOverride_userId_problemId_contextType_contextId_key";
ALTER TABLE "ScoreOverride" DROP COLUMN "userId";

ALTER TYPE "OverrideContextType" RENAME TO "OverrideContextType_old";
CREATE TYPE "OverrideContextType" AS ENUM ('assignment', 'exam');
ALTER TABLE "ScoreOverride" ALTER COLUMN "contextType" TYPE "OverrideContextType" USING ("contextType"::text::"OverrideContextType");
ALTER TABLE "ScoreOverrideAuditLog" ALTER COLUMN "contextType" TYPE "OverrideContextType" USING ("contextType"::text::"OverrideContextType");
DROP TYPE "OverrideContextType_old";
