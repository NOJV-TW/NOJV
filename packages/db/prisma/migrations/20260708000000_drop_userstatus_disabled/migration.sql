-- expand-contract-ok: removing the unused 'disabled' UserStatus value. No application code
-- reads or writes User.status = 'disabled' (User.disabled boolean is the source of truth),
-- so no old/new revision skew during a rolling deploy.

-- AlterEnum
BEGIN;
UPDATE "User" SET "status" = 'active' WHERE "status" = 'disabled';
CREATE TYPE "UserStatus_new" AS ENUM ('active', 'pending_first_login');
ALTER TABLE "User" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "status" TYPE "UserStatus_new" USING ("status"::text::"UserStatus_new");
ALTER TYPE "UserStatus" RENAME TO "UserStatus_old";
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";
DROP TYPE "public"."UserStatus_old";
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'active';
COMMIT;
