ALTER TABLE "Problem" ADD COLUMN "adminMayPublish" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Problem" ADD COLUMN "referenceSolutionSubmissionId" TEXT;
ALTER TABLE "Submission" ADD COLUMN "isReferenceSolution" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX CONCURRENTLY "Problem_referenceSolutionSubmissionId_key" ON "Problem"("referenceSolutionSubmissionId");
CREATE INDEX CONCURRENTLY "Submission_problemId_isReferenceSolution_createdAt_idx" ON "Submission"("problemId", "isReferenceSolution", "createdAt");
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_referenceSolutionSubmissionId_fkey" FOREIGN KEY ("referenceSolutionSubmissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
