-- Per-contest configurable ICPC penalty minutes per wrong submission.
-- Default 20 preserves the previously hard-coded PROBLEM_COUNT_PENALTY_PER_WRONG_SEC (20*60s).
ALTER TABLE "Contest" ADD COLUMN "penaltyMinutesPerWrong" INTEGER NOT NULL DEFAULT 20;
