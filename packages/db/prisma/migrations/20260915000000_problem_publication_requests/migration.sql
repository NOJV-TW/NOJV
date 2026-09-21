CREATE TYPE "ProblemPublicationRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TYPE "AdminAuditAction" ADD VALUE 'problem_publication_approve';
ALTER TYPE "AdminAuditAction" ADD VALUE 'problem_publication_reject';

CREATE TABLE "ProblemPublicationRequest" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" "ProblemPublicationRequestStatus" NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT,
  "reviewNote" TEXT,
  "publishedProblemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "ProblemPublicationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProblemPublicationRequest_publishedProblemId_key"
  ON "ProblemPublicationRequest"("publishedProblemId");
CREATE INDEX "ProblemPublicationRequest_status_createdAt_idx"
  ON "ProblemPublicationRequest"("status", "createdAt");
CREATE INDEX "ProblemPublicationRequest_problemId_createdAt_idx"
  ON "ProblemPublicationRequest"("problemId", "createdAt");
CREATE UNIQUE INDEX "ProblemPublicationRequest_one_pending_per_problem_key"
  ON "ProblemPublicationRequest"("problemId")
  WHERE "status" = 'pending';

ALTER TABLE "ProblemPublicationRequest"
  ADD CONSTRAINT "ProblemPublicationRequest_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemPublicationRequest"
  ADD CONSTRAINT "ProblemPublicationRequest_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemPublicationRequest"
  ADD CONSTRAINT "ProblemPublicationRequest_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemPublicationRequest"
  ADD CONSTRAINT "ProblemPublicationRequest_publishedProblemId_fkey"
  FOREIGN KEY ("publishedProblemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
