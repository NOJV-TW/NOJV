-- expand-contract-ok: removing the unused 'hidden' WorkspaceFileVisibility value. Production
-- had no hidden workspace files when this shipped, and any left over become readonly, so old
-- revisions only ever read 'editable' or 'readonly' during a rolling deploy.

-- AlterEnum
BEGIN;
UPDATE "ProblemWorkspaceFile" SET "visibility" = 'readonly' WHERE "visibility" = 'hidden';
CREATE TYPE "WorkspaceFileVisibility_new" AS ENUM ('editable', 'readonly');
ALTER TABLE "ProblemWorkspaceFile" ALTER COLUMN "visibility" TYPE "WorkspaceFileVisibility_new" USING ("visibility"::text::"WorkspaceFileVisibility_new");
ALTER TYPE "WorkspaceFileVisibility" RENAME TO "WorkspaceFileVisibility_old";
ALTER TYPE "WorkspaceFileVisibility_new" RENAME TO "WorkspaceFileVisibility";
DROP TYPE "WorkspaceFileVisibility_old";
COMMIT;
