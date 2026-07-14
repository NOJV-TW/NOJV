ALTER TABLE "Problem"
  ADD COLUMN "storageGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activeStorageBytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checkerStorage" JSONB,
  ADD COLUMN "interactorStorage" JSONB;

ALTER TABLE "Testcase"
  ADD COLUMN "inputStorage" JSONB,
  ADD COLUMN "outputStorage" JSONB,
  ADD COLUMN "inputFileStorage" JSONB;

ALTER TABLE "ProblemWorkspaceFile"
  ADD COLUMN "contentStorage" JSONB;

ALTER TABLE "Submission"
  ADD COLUMN "sourceStorage" JSONB,
  ADD COLUMN "verdictDetailStorage" JSONB,
  ADD COLUMN "judgeGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activeJudgeRunId" TEXT;

CREATE OR REPLACE FUNCTION "storage_pointer_valid"(pointer JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(pointer) IS DISTINCT FROM 'object' THEN false
    WHEN jsonb_typeof(pointer -> 'key') IS DISTINCT FROM 'string' THEN false
    WHEN length(pointer ->> 'key') = 0 THEN false
    WHEN jsonb_typeof(pointer -> 'sha256') IS DISTINCT FROM 'string' THEN false
    WHEN (pointer ->> 'sha256') !~ '^[a-f0-9]{64}$' THEN false
    WHEN jsonb_typeof(pointer -> 'size') IS DISTINCT FROM 'number' THEN false
    WHEN (pointer ->> 'size') !~ '^(0|[1-9][0-9]*)$' THEN false
    ELSE (pointer ->> 'size')::NUMERIC <= 9007199254740991
  END;
$$;

CREATE OR REPLACE FUNCTION "storage_pointer_map_valid"(pointer_map JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(pointer_map) IS DISTINCT FROM 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_each(pointer_map) AS entry
      WHERE NOT "storage_pointer_valid"(entry.value)
    )
  END;
$$;

ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_storage_accounting_chk"
  CHECK (
    "storageGeneration" >= 0
    AND "activeStorageBytes" BETWEEN 0 AND 52428800
  ) NOT VALID;

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_judge_generation_chk"
  CHECK ("judgeGeneration" >= 0) NOT VALID;
