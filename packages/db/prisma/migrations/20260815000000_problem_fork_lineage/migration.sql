ALTER TABLE "Problem" ADD COLUMN "forkedFromProblemId" TEXT;

CREATE INDEX CONCURRENTLY "Problem_forkedFromProblemId_idx" ON "Problem"("forkedFromProblemId");

ALTER TABLE "Problem"
ADD CONSTRAINT "Problem_forkedFromProblemId_fkey"
FOREIGN KEY ("forkedFromProblemId") REFERENCES "Problem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
