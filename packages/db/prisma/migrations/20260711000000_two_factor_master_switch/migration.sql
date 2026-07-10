-- AlterTable
ALTER TABLE "User" ADD COLUMN "twoFactorActivated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: fields required by the better-auth two-factor plugin (verification lockout).
ALTER TABLE "TwoFactor" ADD COLUMN "failedVerificationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TwoFactor" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- Backfill: users who already have a second factor (TOTP or a passkey) are treated
-- as having the master switch on, so the new gate does not lock them out.
UPDATE "User"
SET "twoFactorActivated" = true
WHERE "twoFactorEnabled" = true
   OR "id" IN (SELECT DISTINCT "userId" FROM "Passkey");
