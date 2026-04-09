-- Phase 1 of docs/plans/active/2026-04-09-problem-ui-redesign.md
--
-- IMPORTANT: Run the data migration script
-- (packages/db/src/migrations/problem-ui-redesign-phase-1.ts) BEFORE applying
-- this SQL migration. The data migration reads TestcaseSet.isHidden and
-- ProblemTemplate to populate Problem.samples and ProblemWorkspaceFile. Once
-- this DDL runs, the isHidden column is gone and sample extraction becomes
-- impossible.

-- CreateEnum
CREATE TYPE "ProblemMode" AS ENUM ('standard', 'advanced');

-- CreateEnum
CREATE TYPE "ProblemImageSource" AS ENUM ('registry', 'tarball');

-- CreateEnum
CREATE TYPE "WorkspaceFileVisibility" AS ENUM ('editable', 'readonly', 'hidden');

-- AlterTable
ALTER TABLE "Problem"
  ADD COLUMN "mode" "ProblemMode" NOT NULL DEFAULT 'standard',
  ADD COLUMN "samples" JSONB,
  ADD COLUMN "advancedImageRef" TEXT,
  ADD COLUMN "advancedImageSource" "ProblemImageSource";

-- AlterTable
ALTER TABLE "Contest"
  ADD COLUMN "adjustmentRules" JSONB;

-- AlterTable
ALTER TABLE "CourseAssessment"
  ADD COLUMN "adjustmentRules" JSONB;

-- AlterTable
ALTER TABLE "TestcaseSet"
  DROP COLUMN "isHidden";

-- CreateTable
CREATE TABLE "ProblemWorkspaceFile" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "language" "SupportedLanguage" NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" "WorkspaceFileVisibility" NOT NULL,
    "editableRegions" JSONB,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemWorkspaceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProblemWorkspaceFile_problemId_language_idx" ON "ProblemWorkspaceFile"("problemId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemWorkspaceFile_problemId_language_path_key" ON "ProblemWorkspaceFile"("problemId", "language", "path");

-- AddForeignKey
ALTER TABLE "ProblemWorkspaceFile" ADD CONSTRAINT "ProblemWorkspaceFile_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
