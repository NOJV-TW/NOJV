BEGIN;
ALTER TABLE "Assessment" ADD COLUMN "totalPoints" DECIMAL(18,4) NOT NULL DEFAULT 100,
  ADD COLUMN "gradingRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "detachedProblemIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Exam" ADD COLUMN "totalPoints" DECIMAL(18,4) NOT NULL DEFAULT 100,
  ADD COLUMN "gradingRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "detachedProblemIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AssessmentProblem" ALTER COLUMN "points" TYPE DECIMAL(18,8), ALTER COLUMN "points" SET DEFAULT 0;
ALTER TABLE "ExamProblem" ALTER COLUMN "points" TYPE DECIMAL(18,8), ALTER COLUMN "points" SET DEFAULT 0;
ALTER TABLE "Participation" ALTER COLUMN "score" TYPE DECIMAL(18,2),
  ADD COLUMN "gradingRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TEMP TABLE activity_raw_max ON COMMIT DROP AS
SELECT p.id, CASE WHEN p.type = 'special_env' THEN COALESCE((p."advancedConfig"->>'maxScore')::numeric, 100)
  ELSE COALESCE(NULLIF((SELECT SUM(t.weight) FROM "TestcaseSet" t WHERE t."problemId" = p.id), 0), 100) END AS points
FROM "Problem" p;
UPDATE "AssessmentProblem" a SET points = m.points FROM activity_raw_max m WHERE m.id = a."problemId";
UPDATE "ExamProblem" a SET points = m.points FROM activity_raw_max m WHERE m.id = a."problemId";
UPDATE "Assessment" a SET "totalPoints" = q.total FROM
  (SELECT "assessmentId" id, SUM(points) total FROM "AssessmentProblem" GROUP BY "assessmentId") q WHERE a.id = q.id;
UPDATE "Exam" a SET "totalPoints" = q.total FROM
  (SELECT "examId" id, SUM(points) total FROM "ExamProblem" GROUP BY "examId") q WHERE a.id = q.id;

ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_totalPoints_positive" CHECK ("totalPoints" > 0);
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_totalPoints_positive" CHECK ("totalPoints" > 0);
ALTER TABLE "AssessmentProblem" ADD CONSTRAINT "AssessmentProblem_points_nonnegative" CHECK (points >= 0);
ALTER TABLE "ExamProblem" ADD CONSTRAINT "ExamProblem_points_nonnegative" CHECK (points >= 0);
COMMIT;
