ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "isSuperAdmin" = true WHERE "platformRole" = 'admin';
