-- AssessmentAuditLog: append-only trail for assessment lifecycle
-- transitions. `assessmentId` is a plain string (no FK) so the audit
-- entry outlives a `delete_draft`. `actorUserId` is null for
-- system-initiated transitions (Temporal auto-publish).

-- CreateEnum
CREATE TYPE "AssessmentAuditAction" AS ENUM ('publish', 'revert_to_draft', 'delete_draft');

-- CreateEnum
CREATE TYPE "EditorialReportStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "AssessmentAuditLog" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AssessmentAuditAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentAuditLog_assessmentId_createdAt_idx" ON "AssessmentAuditLog"("assessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "AssessmentAuditLog_courseId_createdAt_idx" ON "AssessmentAuditLog"("courseId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssessmentAuditLog" ADD CONSTRAINT "AssessmentAuditLog_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAuditLog" ADD CONSTRAINT "AssessmentAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EditorialReport: user-filed report against an editorial. One report
-- per (editorial, reporter). Surfaces in the admin moderation queue.

-- CreateTable
CREATE TABLE "EditorialReport" (
    "id" TEXT NOT NULL,
    "editorialId" TEXT NOT NULL,
    "reportedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "EditorialReportStatus" NOT NULL DEFAULT 'open',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EditorialReport_editorialId_reportedByUserId_key" ON "EditorialReport"("editorialId", "reportedByUserId");

-- CreateIndex
CREATE INDEX "EditorialReport_status_createdAt_idx" ON "EditorialReport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "EditorialReport" ADD CONSTRAINT "EditorialReport_editorialId_fkey" FOREIGN KEY ("editorialId") REFERENCES "Editorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialReport" ADD CONSTRAINT "EditorialReport_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialReport" ADD CONSTRAINT "EditorialReport_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
