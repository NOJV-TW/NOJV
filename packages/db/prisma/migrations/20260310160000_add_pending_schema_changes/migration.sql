-- AlterEnum
BEGIN;
CREATE TYPE "PlatformRole_new" AS ENUM ('admin', 'teacher', 'student');
ALTER TABLE "public"."User" ALTER COLUMN "platformRole" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "platformRole" TYPE "PlatformRole_new" USING ("platformRole"::text::"PlatformRole_new");
ALTER TYPE "PlatformRole" RENAME TO "PlatformRole_old";
ALTER TYPE "PlatformRole_new" RENAME TO "PlatformRole";
DROP TYPE "public"."PlatformRole_old";
ALTER TABLE "User" ALTER COLUMN "platformRole" SET DEFAULT 'student';
COMMIT;

-- AlterTable
ALTER TABLE "CourseAssessment" ADD COLUMN     "ipLockEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxAttempts" INTEGER,
ADD COLUMN     "pageLockEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProblemStatementI18n" ADD COLUMN     "inputFormat" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "outputFormat" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "sampleOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseMembership_userId_status_idx" ON "CourseMembership"("userId", "status");
