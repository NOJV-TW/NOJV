-- Phase 7 follow-up: persist Advanced Mode resource limits + testcases.

ALTER TABLE "Problem" ADD COLUMN "advancedResourceLimits" JSONB;

CREATE TABLE "AdvancedTestcase" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "stdin" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvancedTestcase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdvancedTestcase_problemId_idx" ON "AdvancedTestcase"("problemId");

CREATE UNIQUE INDEX "AdvancedTestcase_problemId_ordinal_key" ON "AdvancedTestcase"("problemId", "ordinal");

ALTER TABLE "AdvancedTestcase" ADD CONSTRAINT "AdvancedTestcase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
