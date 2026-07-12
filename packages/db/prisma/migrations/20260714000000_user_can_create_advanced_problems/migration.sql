ALTER TABLE "User" ADD COLUMN "canCreateAdvancedProblems" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "AdminAuditAction" ADD VALUE 'user_advanced_toggle';
