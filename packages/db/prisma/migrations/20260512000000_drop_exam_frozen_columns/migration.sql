-- YAGNI cleanup: Exam doesn't need scoreboard freezing (Contest does, kept).
ALTER TABLE "Exam" DROP COLUMN "frozenBoard", DROP COLUMN "frozenAt";
