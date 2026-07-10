-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'assignment_started';
ALTER TYPE "NotificationType" ADD VALUE 'editorial_removed';

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "emailAssignmentStarted" BOOLEAN NOT NULL DEFAULT true,
    "emailAssignmentDueSoon" BOOLEAN NOT NULL DEFAULT true,
    "assignmentDueSoonLeadDays" INTEGER NOT NULL DEFAULT 3,
    "emailExamStarting" BOOLEAN NOT NULL DEFAULT true,
    "examStartingLeadDays" INTEGER NOT NULL DEFAULT 1,
    "emailContestStarting" BOOLEAN NOT NULL DEFAULT true,
    "contestStartingLeadDays" INTEGER NOT NULL DEFAULT 1,
    "emailSystemAnnouncement" BOOLEAN NOT NULL DEFAULT true,
    "emailCourseAnnouncement" BOOLEAN NOT NULL DEFAULT true,
    "emailCourseEnrolled" BOOLEAN NOT NULL DEFAULT true,
    "emailRoleChanged" BOOLEAN NOT NULL DEFAULT true,
    "emailEditorialRemoved" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
