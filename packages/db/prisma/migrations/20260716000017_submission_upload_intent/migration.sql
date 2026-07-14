ALTER TABLE "Submission"
  ALTER COLUMN "sourceStorage" DROP NOT NULL;

ALTER TABLE "Submission"
  DROP CONSTRAINT "Submission_source_storage_pointer_chk";

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_source_storage_pointer_chk"
  CHECK (
    (
      "sourceStorage" IS NULL
      AND "status" IN ('pending_upload', 'system_error')
    )
    OR (
      "sourceStorage" IS NOT NULL
      AND "storage_pointer_valid"("sourceStorage")
    )
  );
