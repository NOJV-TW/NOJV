-- Drop the unused `zip_project` value from the SubmissionType enum.
--
-- Background: `zip_project` was the legacy "student uploads a ZIP" path
-- that was superseded by (a) the workspace-file multi-file mode (teacher
-- ships main.<ext> + helpers, student edits in-browser) and (b) advanced
-- mode (tarball upload that runs inside a TA-provided Docker image).
-- No problem row has ever used `zip_project` in this database — verified
-- by `SELECT "submissionType", COUNT(*) FROM "Problem" GROUP BY ...`.
--
-- Postgres does not support `ALTER TYPE ... DROP VALUE` directly, so the
-- standard workaround is: create a new enum with the desired values,
-- migrate the column, drop the old enum, rename the new one.
BEGIN;

CREATE TYPE "SubmissionType_new" AS ENUM ('function', 'full_source');

ALTER TABLE "Problem"
  ALTER COLUMN "submissionType" DROP DEFAULT,
  ALTER COLUMN "submissionType" TYPE "SubmissionType_new"
    USING ("submissionType"::text::"SubmissionType_new"),
  ALTER COLUMN "submissionType" SET DEFAULT 'full_source';

DROP TYPE "SubmissionType";
ALTER TYPE "SubmissionType_new" RENAME TO "SubmissionType";

COMMIT;
