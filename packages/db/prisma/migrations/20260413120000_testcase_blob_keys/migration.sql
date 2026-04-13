-- Move testcase + workspace file payloads out of Postgres into S3 (object
-- storage via @nojv/storage). Drops the four content columns and replaces
-- them with key columns that point at S3 objects. The actual blobs are
-- written by the domain layer as part of the create / update flows.
--
-- Data strategy (per design doc 2026-04-13-testcase-blob-storage-design.md):
-- there is no production data to preserve, so we wipe both tables before
-- adding the new NOT NULL columns instead of routing through a default.
-- The seed script repopulates everything via the same domain mutations the
-- application uses, so the new key columns get filled correctly.

TRUNCATE TABLE "Testcase", "ProblemWorkspaceFile" CASCADE;

ALTER TABLE "Testcase" DROP COLUMN "input";
ALTER TABLE "Testcase" DROP COLUMN "output";
ALTER TABLE "Testcase" DROP COLUMN "inputFiles";

ALTER TABLE "Testcase" ADD COLUMN "inputKey" TEXT NOT NULL;
ALTER TABLE "Testcase" ADD COLUMN "outputKey" TEXT;
ALTER TABLE "Testcase" ADD COLUMN "inputFileKeys" JSONB;

ALTER TABLE "ProblemWorkspaceFile" DROP COLUMN "content";
ALTER TABLE "ProblemWorkspaceFile" ADD COLUMN "contentKey" TEXT NOT NULL;
