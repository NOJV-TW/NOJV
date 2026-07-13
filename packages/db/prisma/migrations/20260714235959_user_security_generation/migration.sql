ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "securityGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User"
ADD CONSTRAINT "User_security_generation_nonnegative_chk"
CHECK ("securityGeneration" >= 0);

CREATE OR REPLACE FUNCTION enforce_user_security_generation_monotonic()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."securityGeneration" < OLD."securityGeneration" THEN
    RAISE EXCEPTION 'User.securityGeneration cannot decrease'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bump_user_security_generation_on_state_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."securityGeneration" := GREATEST(
    NEW."securityGeneration",
    OLD."securityGeneration" + 1
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bump_security_generation_for_related_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "User"
    SET "securityGeneration" = "securityGeneration" + 1
    WHERE "id" = OLD."userId";
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    UPDATE "User"
    SET "securityGeneration" = "securityGeneration" + 1
    WHERE "id" = NEW."userId";
    RETURN NEW;
  END IF;

  IF OLD."userId" IS DISTINCT FROM NEW."userId" THEN
    UPDATE "User"
    SET "securityGeneration" = "securityGeneration" + 1
    WHERE "id" IN (OLD."userId", NEW."userId");
  ELSE
    UPDATE "User"
    SET "securityGeneration" = "securityGeneration" + 1
    WHERE "id" = NEW."userId";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_security_generation_monotonic ON "User";
CREATE TRIGGER user_security_generation_monotonic
BEFORE UPDATE OF "securityGeneration" ON "User"
FOR EACH ROW
WHEN (NEW."securityGeneration" < OLD."securityGeneration")
EXECUTE FUNCTION enforce_user_security_generation_monotonic();

DROP TRIGGER IF EXISTS user_security_generation_state_change ON "User";
CREATE TRIGGER user_security_generation_state_change
BEFORE UPDATE OF
  "email",
  "emailVerified",
  "platformRole",
  "isSuperAdmin",
  "disabled",
  "status",
  "mustChangePassword",
  "twoFactorEnabled",
  "twoFactorActivated"
ON "User"
FOR EACH ROW
WHEN (
  OLD."email" IS DISTINCT FROM NEW."email"
  OR OLD."emailVerified" IS DISTINCT FROM NEW."emailVerified"
  OR OLD."platformRole" IS DISTINCT FROM NEW."platformRole"
  OR OLD."isSuperAdmin" IS DISTINCT FROM NEW."isSuperAdmin"
  OR OLD."disabled" IS DISTINCT FROM NEW."disabled"
  OR OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."mustChangePassword" IS DISTINCT FROM NEW."mustChangePassword"
  OR OLD."twoFactorEnabled" IS DISTINCT FROM NEW."twoFactorEnabled"
  OR OLD."twoFactorActivated" IS DISTINCT FROM NEW."twoFactorActivated"
)
EXECUTE FUNCTION bump_user_security_generation_on_state_change();

DROP TRIGGER IF EXISTS account_security_generation_membership_change ON "Account";
CREATE TRIGGER account_security_generation_membership_change
AFTER INSERT OR DELETE ON "Account"
FOR EACH ROW
EXECUTE FUNCTION bump_security_generation_for_related_user();

DROP TRIGGER IF EXISTS account_security_generation_credential_change ON "Account";
CREATE TRIGGER account_security_generation_credential_change
AFTER UPDATE OF "userId", "providerId", "accountId", "password" ON "Account"
FOR EACH ROW
WHEN (
  OLD."userId" IS DISTINCT FROM NEW."userId"
  OR OLD."providerId" IS DISTINCT FROM NEW."providerId"
  OR OLD."accountId" IS DISTINCT FROM NEW."accountId"
  OR OLD."password" IS DISTINCT FROM NEW."password"
)
EXECUTE FUNCTION bump_security_generation_for_related_user();

DROP TRIGGER IF EXISTS two_factor_security_generation_membership_change ON "TwoFactor";
CREATE TRIGGER two_factor_security_generation_membership_change
AFTER INSERT OR DELETE ON "TwoFactor"
FOR EACH ROW
EXECUTE FUNCTION bump_security_generation_for_related_user();

DROP TRIGGER IF EXISTS two_factor_security_generation_credential_change ON "TwoFactor";
CREATE TRIGGER two_factor_security_generation_credential_change
AFTER UPDATE OF "userId", "secret", "backupCodes", "verified" ON "TwoFactor"
FOR EACH ROW
WHEN (
  OLD."userId" IS DISTINCT FROM NEW."userId"
  OR OLD."secret" IS DISTINCT FROM NEW."secret"
  OR OLD."backupCodes" IS DISTINCT FROM NEW."backupCodes"
  OR OLD."verified" IS DISTINCT FROM NEW."verified"
)
EXECUTE FUNCTION bump_security_generation_for_related_user();

DROP TRIGGER IF EXISTS passkey_security_generation_membership_change ON "Passkey";
CREATE TRIGGER passkey_security_generation_membership_change
AFTER INSERT OR DELETE ON "Passkey"
FOR EACH ROW
EXECUTE FUNCTION bump_security_generation_for_related_user();

DROP TRIGGER IF EXISTS passkey_security_generation_credential_change ON "Passkey";
CREATE TRIGGER passkey_security_generation_credential_change
AFTER UPDATE OF "userId", "credentialID", "publicKey"
ON "Passkey"
FOR EACH ROW
WHEN (
  OLD."userId" IS DISTINCT FROM NEW."userId"
  OR OLD."credentialID" IS DISTINCT FROM NEW."credentialID"
  OR OLD."publicKey" IS DISTINCT FROM NEW."publicKey"
)
EXECUTE FUNCTION bump_security_generation_for_related_user();
