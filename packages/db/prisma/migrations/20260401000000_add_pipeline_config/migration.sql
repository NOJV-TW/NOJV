-- AlterTable: Add pipeline configuration fields to Problem
ALTER TABLE "Problem" ADD COLUMN "pipelineConfig" JSONB;
ALTER TABLE "Problem" ADD COLUMN "scoringScript" TEXT;
ALTER TABLE "Problem" ADD COLUMN "scoringLanguage" TEXT;
ALTER TABLE "Problem" ADD COLUMN "artifactPatterns" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Problem" ADD COLUMN "networkAccessConfig" JSONB;

-- AlterTable: Add pipeline result fields to Submission
ALTER TABLE "Submission" ADD COLUMN "pipelineResult" JSONB;
ALTER TABLE "Submission" ADD COLUMN "artifactPaths" TEXT[] DEFAULT ARRAY[]::TEXT[];
