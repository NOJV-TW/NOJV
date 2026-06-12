-- DropForeignKey
ALTER TABLE "ContestProblem" DROP CONSTRAINT "ContestProblem_problemId_fkey";

-- DropForeignKey
ALTER TABLE "AssessmentProblem" DROP CONSTRAINT "AssessmentProblem_problemId_fkey";

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentProblem" ADD CONSTRAINT "AssessmentProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
