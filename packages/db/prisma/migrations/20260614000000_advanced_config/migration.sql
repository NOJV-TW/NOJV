-- Advanced (special_env) problems move from flat image fields to a structured
-- advancedConfig JSON (run/grade image refs + network policy). Submission gains
-- advancedConfigSnapshot for a later phase. The ProblemImageSource enum is now
-- carried inside advancedConfig and dropped from the database. Pre-production: no
-- data backfill required.
ALTER TABLE "Problem" DROP COLUMN "advancedImageRef",
DROP COLUMN "advancedImageSource",
ADD COLUMN     "advancedConfig" JSONB;

ALTER TABLE "Submission" ADD COLUMN     "advancedConfigSnapshot" JSONB;

DROP TYPE "ProblemImageSource";
