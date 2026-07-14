-- expand-contract-ok: 00011 only adds nullable pointer columns. This contract
-- migration aborts unless the checked S3 backfill populated and verified every
-- required pointer, removed all validator keys from judgeConfig, and matched
-- every optional legacy key. New readers/writers use only the pointer columns.
CREATE OR REPLACE FUNCTION "storage_pointer_valid"(pointer JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    jsonb_typeof(pointer) = 'object'
    AND jsonb_typeof(pointer -> 'key') = 'string'
    AND length(pointer ->> 'key') > 0
    AND jsonb_typeof(pointer -> 'sha256') = 'string'
    AND (pointer ->> 'sha256') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(pointer -> 'size') = 'number'
    AND (pointer ->> 'size') ~ '^(0|[1-9][0-9]*)$'
    AND (pointer ->> 'size')::NUMERIC <= 9007199254740991;
$$;

CREATE OR REPLACE FUNCTION "storage_pointer_map_valid"(pointer_map JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    jsonb_typeof(pointer_map) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(pointer_map) AS entry
      WHERE NOT "storage_pointer_valid"(entry.value)
    );
$$;

DO $$
DECLARE
  invalid_testcases BIGINT;
  invalid_workspace BIGINT;
  invalid_submissions BIGINT;
  invalid_optional BIGINT;
  legacy_validator_config BIGINT;
BEGIN
  SELECT count(*) INTO invalid_testcases
  FROM "Testcase"
  WHERE NOT "storage_pointer_valid"("inputStorage")
     OR ("outputKey" IS NOT NULL AND NOT "storage_pointer_valid"("outputStorage"))
     OR ("outputKey" IS NULL AND "outputStorage" IS NOT NULL)
     OR (
       "inputFileKeys" IS NOT NULL
       AND (
         jsonb_typeof("inputFileStorage") <> 'object'
         OR EXISTS (
           SELECT 1
           FROM jsonb_each("inputFileStorage") AS entry
           WHERE NOT "storage_pointer_valid"(entry.value)
         )
       )
     )
     OR ("inputFileKeys" IS NULL AND "inputFileStorage" IS NOT NULL);

  SELECT count(*) INTO invalid_workspace
  FROM "ProblemWorkspaceFile"
  WHERE NOT "storage_pointer_valid"("contentStorage");

  SELECT count(*) INTO invalid_submissions
  FROM "Submission"
  WHERE NOT "storage_pointer_valid"("sourceStorage")
     OR (
       "verdictDetailStorageKey" IS NOT NULL
       AND NOT "storage_pointer_valid"("verdictDetailStorage")
     )
     OR ("verdictDetailStorageKey" IS NULL AND "verdictDetailStorage" IS NOT NULL);

  SELECT count(*) INTO invalid_optional
  FROM "Problem"
  WHERE ("checkerStorage" IS NOT NULL AND NOT "storage_pointer_valid"("checkerStorage"))
     OR (
       "interactorStorage" IS NOT NULL
       AND NOT "storage_pointer_valid"("interactorStorage")
     );

  SELECT count(*) INTO legacy_validator_config
  FROM "Problem"
  WHERE "judgeConfig" ?| ARRAY[
    'checkerKey',
    'interactorKey',
    'checkerScript',
    'interactorScript'
  ];

  IF invalid_testcases > 0
     OR invalid_workspace > 0
     OR invalid_submissions > 0
     OR invalid_optional > 0
     OR legacy_validator_config > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Versioned storage pointer cutover blocked: testcase=%s workspace=%s submission=%s optional=%s legacy_validator_config=%s. Quiesce writes, run pnpm --filter @nojv/db storage:backfill, verify the restored snapshot, then rerun migrate deploy.',
        invalid_testcases,
        invalid_workspace,
        invalid_submissions,
        invalid_optional,
        legacy_validator_config
      );
  END IF;
END $$;

ALTER TABLE "Problem" VALIDATE CONSTRAINT "Problem_storage_accounting_chk";
ALTER TABLE "Submission" VALIDATE CONSTRAINT "Submission_judge_generation_chk";

ALTER TABLE "Testcase" ALTER COLUMN "inputStorage" SET NOT NULL;
ALTER TABLE "ProblemWorkspaceFile" ALTER COLUMN "contentStorage" SET NOT NULL;
ALTER TABLE "Submission" ALTER COLUMN "sourceStorage" SET NOT NULL;

ALTER TABLE "Testcase"
  ADD CONSTRAINT "Testcase_input_storage_pointer_chk"
  CHECK ("storage_pointer_valid"("inputStorage"));

ALTER TABLE "Testcase"
  ADD CONSTRAINT "Testcase_output_storage_pointer_chk"
  CHECK (
    "outputStorage" IS NULL
    OR "storage_pointer_valid"("outputStorage")
  );

ALTER TABLE "Testcase"
  ADD CONSTRAINT "Testcase_input_file_storage_pointer_chk"
  CHECK (
    "inputFileStorage" IS NULL
    OR "storage_pointer_map_valid"("inputFileStorage")
  );

ALTER TABLE "ProblemWorkspaceFile"
  ADD CONSTRAINT "ProblemWorkspaceFile_content_storage_pointer_chk"
  CHECK ("storage_pointer_valid"("contentStorage"));

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_source_storage_pointer_chk"
  CHECK ("storage_pointer_valid"("sourceStorage"));

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_verdict_storage_pointer_chk"
  CHECK (
    "verdictDetailStorage" IS NULL
    OR "storage_pointer_valid"("verdictDetailStorage")
  );

ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_checker_storage_pointer_chk"
  CHECK (
    "checkerStorage" IS NULL
    OR "storage_pointer_valid"("checkerStorage")
  );

ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_interactor_storage_pointer_chk"
  CHECK (
    "interactorStorage" IS NULL
    OR "storage_pointer_valid"("interactorStorage")
  );

ALTER TABLE "Testcase"
  DROP COLUMN "inputKey",
  DROP COLUMN "outputKey",
  DROP COLUMN "inputFileKeys";

ALTER TABLE "ProblemWorkspaceFile" DROP COLUMN "contentKey";

ALTER TABLE "Submission"
  DROP COLUMN "sourceStoragePrefix",
  DROP COLUMN "verdictDetailStorageKey";
