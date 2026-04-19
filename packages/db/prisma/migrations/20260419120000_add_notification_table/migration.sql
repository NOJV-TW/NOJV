-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
    'assignment_due_soon',
    'exam_starting_soon',
    'contest_starting_soon',
    'course_enrolled',
    'announcement_published',
    'role_changed',
    'clarification_answered'
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "params" JSONB NOT NULL,
    "linkUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
