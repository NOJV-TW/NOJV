-- expand-contract-ok: deploy-release.sh drains web and both workers before this contract;
-- the problem-library-v1 admission fence prevents incompatible writers after migration.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE "User", "Problem", "Course", "Assessment", "AssessmentProblem", "Exam", "ExamProblem", "Submission" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  missing_owner_problem TEXT;
BEGIN
  SELECT p."id" INTO missing_owner_problem
  FROM "Problem" p LEFT JOIN "User" u ON u."id" = p."authorId"
  WHERE u."id" IS NULL ORDER BY p."id" LIMIT 1;
  IF missing_owner_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Course problem permissions require an existing owner: Problem %', missing_owner_problem
      USING HINT = 'Explicitly transfer this problem to an existing individual before retrying. Do not infer an owner from course staff or the migration operator.';
  END IF;
END $$;

ALTER TABLE "Problem" DROP CONSTRAINT "Problem_authorId_fkey";
ALTER TABLE "Problem" ALTER COLUMN "authorId" SET NOT NULL;
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CourseProblem" (
  "courseId" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "addedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseProblem_pkey" PRIMARY KEY ("courseId", "problemId")
);
CREATE INDEX "CourseProblem_problemId_idx" ON "CourseProblem"("problemId");
ALTER TABLE "CourseProblem" ADD CONSTRAINT "CourseProblem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseProblem" ADD CONSTRAINT "CourseProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseProblem" ADD CONSTRAINT "CourseProblem_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TEMP TABLE expected_course_problems ON COMMIT DROP AS
  SELECT a."courseId", ap."problemId" FROM "AssessmentProblem" ap JOIN "Assessment" a ON a.id = ap."assessmentId"
  UNION
  SELECT e."courseId", ep."problemId" FROM "ExamProblem" ep JOIN "Exam" e ON e.id = ep."examId"
  UNION
  SELECT s."courseId", s."problemId" FROM "Submission" s JOIN "Assessment" a ON a.id = s."assessmentId" AND a."courseId" = s."courseId"
  UNION
  SELECT e."courseId", s."problemId" FROM "Submission" s JOIN "Exam" e ON e.id = s."examId";

INSERT INTO "CourseProblem" ("courseId", "problemId")
SELECT "courseId", "problemId" FROM expected_course_problems
ON CONFLICT ("courseId", "problemId") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    (SELECT "courseId", "problemId" FROM expected_course_problems EXCEPT SELECT "courseId", "problemId" FROM "CourseProblem")
    UNION ALL
    (SELECT "courseId", "problemId" FROM "CourseProblem" EXCEPT SELECT "courseId", "problemId" FROM expected_course_problems)
  ) THEN
    RAISE EXCEPTION 'Course problem backfill did not exactly match verified activity and submission links';
  END IF;
END $$;
COMMIT;
