-- expand-contract-ok: editorial tables are renamed in place to problem posts;
-- web/worker roll out together and the old-pod window only affects editorial
-- reads/writes, which is acceptable downtime for this low-traffic surface.

CREATE TYPE "ProblemPostType" AS ENUM ('editorial', 'discussion');

ALTER TYPE "EditorialReportStatus" RENAME TO "ContentReportStatus";

ALTER TYPE "NotificationType" ADD VALUE 'post_removed';
ALTER TYPE "NotificationType" ADD VALUE 'comment_removed';

ALTER TYPE "AdminAuditAction" ADD VALUE 'content_report_resolve';
ALTER TYPE "AdminAuditAction" ADD VALUE 'content_report_dismiss';

ALTER TABLE "Editorial" RENAME TO "ProblemPost";
ALTER TABLE "ProblemPost" RENAME CONSTRAINT "Editorial_pkey" TO "ProblemPost_pkey";
ALTER TABLE "ProblemPost" RENAME COLUMN "userId" TO "authorId";
ALTER TABLE "ProblemPost" RENAME CONSTRAINT "Editorial_userId_fkey" TO "ProblemPost_authorId_fkey";
ALTER TABLE "ProblemPost" RENAME CONSTRAINT "Editorial_problemId_fkey" TO "ProblemPost_problemId_fkey";

ALTER TABLE "ProblemPost" ADD COLUMN "type" "ProblemPostType" NOT NULL DEFAULT 'editorial';
ALTER TABLE "ProblemPost" ALTER COLUMN "type" DROP DEFAULT;

UPDATE "ProblemPost" SET "title" = "language"::text WHERE "title" = '';
ALTER TABLE "ProblemPost" ALTER COLUMN "title" DROP DEFAULT;

DROP INDEX "Editorial_userId_problemId_language_key";
ALTER TABLE "ProblemPost" DROP COLUMN "language";

DROP INDEX "Editorial_problemId_createdAt_idx";
CREATE INDEX "ProblemPost_problemId_type_createdAt_idx" ON "ProblemPost"("problemId", "type", "createdAt");

ALTER TABLE "EditorialVote" RENAME TO "PostVote";
ALTER TABLE "PostVote" RENAME CONSTRAINT "EditorialVote_pkey" TO "PostVote_pkey";
ALTER TABLE "PostVote" RENAME COLUMN "editorialId" TO "postId";
ALTER TABLE "PostVote" RENAME CONSTRAINT "EditorialVote_editorialId_fkey" TO "PostVote_postId_fkey";
ALTER TABLE "PostVote" RENAME CONSTRAINT "EditorialVote_userId_fkey" TO "PostVote_userId_fkey";
ALTER INDEX "EditorialVote_editorialId_idx" RENAME TO "PostVote_postId_idx";
ALTER INDEX "EditorialVote_editorialId_userId_key" RENAME TO "PostVote_postId_userId_key";

CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PostComment_postId_createdAt_idx" ON "PostComment"("postId", "createdAt");

ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ProblemPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EditorialReport" RENAME TO "ContentReport";
ALTER TABLE "ContentReport" RENAME CONSTRAINT "EditorialReport_pkey" TO "ContentReport_pkey";
ALTER TABLE "ContentReport" RENAME COLUMN "editorialId" TO "postId";
ALTER TABLE "ContentReport" ALTER COLUMN "postId" DROP NOT NULL;
ALTER TABLE "ContentReport" RENAME CONSTRAINT "EditorialReport_editorialId_fkey" TO "ContentReport_postId_fkey";
ALTER TABLE "ContentReport" RENAME CONSTRAINT "EditorialReport_reportedByUserId_fkey" TO "ContentReport_reportedByUserId_fkey";
ALTER TABLE "ContentReport" RENAME CONSTRAINT "EditorialReport_resolvedByUserId_fkey" TO "ContentReport_resolvedByUserId_fkey";
ALTER INDEX "EditorialReport_editorialId_reportedByUserId_key" RENAME TO "ContentReport_postId_reportedByUserId_key";
ALTER INDEX "EditorialReport_status_createdAt_idx" RENAME TO "ContentReport_status_createdAt_idx";

ALTER TABLE "ContentReport" ADD COLUMN "commentId" TEXT;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ContentReport_commentId_reportedByUserId_key" ON "ContentReport"("commentId", "reportedByUserId");

ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_target_check" CHECK (num_nonnulls("postId", "commentId") = 1);
