-- Teacher "reset IP binding": grace window during which the exam IP gate is
-- skipped for one student so they can re-pin after a machine swap.
ALTER TABLE "ExamParticipation" ADD COLUMN "ipGateExemptUntil" TIMESTAMP(3);
