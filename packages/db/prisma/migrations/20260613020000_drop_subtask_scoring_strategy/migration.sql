-- Subtask scoring converged to all-or-nothing: a subtask earns its full weight
-- only if every case is AC, otherwise 0. The per-subtask strategy column and its
-- enum are removed; checkers/interactors render AC/WA only (no partial scoring).
ALTER TABLE "TestcaseSet" DROP COLUMN "scoringStrategy";

DROP TYPE "SubtaskScoringStrategy";
