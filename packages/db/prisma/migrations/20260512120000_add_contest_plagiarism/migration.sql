-- Add inline plagiarism fields to Contest (mirror Exam shape).
ALTER TABLE "Contest"
  ADD COLUMN "plagiarismStatus"        "PlagiarismReportStatus",
  ADD COLUMN "plagiarismResults"       JSONB,
  ADD COLUMN "plagiarismReportUrl"     TEXT,
  ADD COLUMN "plagiarismTriggeredAt"   TIMESTAMP(3),
  ADD COLUMN "plagiarismCompletedAt"   TIMESTAMP(3),
  ADD COLUMN "plagiarismTriggeredById" TEXT;

ALTER TABLE "Contest"
  ADD CONSTRAINT "Contest_plagiarismTriggeredById_fkey"
  FOREIGN KEY ("plagiarismTriggeredById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
