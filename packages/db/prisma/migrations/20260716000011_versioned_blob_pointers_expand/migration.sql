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

ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_storage_accounting_chk"
  CHECK (
    "storageGeneration" >= 0
    AND "activeStorageBytes" BETWEEN 0 AND 52428800
  ) NOT VALID;

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_judge_generation_chk"
  CHECK ("judgeGeneration" >= 0) NOT VALID;
