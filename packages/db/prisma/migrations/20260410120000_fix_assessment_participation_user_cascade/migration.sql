-- Align AssessmentParticipation.userId FK with schema.prisma.
--
-- Migration 20260320000000_ip_lock_redesign created this constraint with
-- ON DELETE RESTRICT, but schema.prisma:605 declares `onDelete: Cascade`.
-- Without this fix, deleting a User errors out at the DB level whenever
-- the user has any AssessmentParticipation rows, which contradicts what
-- the Prisma client (and application code) assume.

ALTER TABLE "AssessmentParticipation" DROP CONSTRAINT "AssessmentParticipation_userId_fkey";

ALTER TABLE "AssessmentParticipation" ADD CONSTRAINT "AssessmentParticipation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
