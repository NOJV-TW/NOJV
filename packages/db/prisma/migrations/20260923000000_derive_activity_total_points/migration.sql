-- totalPoints is now derived server-side as the sum of the activity's problem points,
-- so an activity with no problems (or only zero-point problems) is legitimately worth 0.
-- Publishing still requires a positive total; that rule lives in the application layer.
ALTER TABLE "Assessment" DROP CONSTRAINT IF EXISTS "Assessment_totalPoints_positive";
ALTER TABLE "Exam" DROP CONSTRAINT IF EXISTS "Exam_totalPoints_positive";
ALTER TABLE "Assessment" ALTER COLUMN "totalPoints" SET DEFAULT 0;
ALTER TABLE "Exam" ALTER COLUMN "totalPoints" SET DEFAULT 0;
