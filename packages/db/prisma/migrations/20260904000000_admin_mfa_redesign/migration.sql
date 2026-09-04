DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User" u
    WHERE u."isSuperAdmin" = true
      AND NOT EXISTS (
        SELECT 1
        FROM "Account" a
        WHERE a."userId" = u."id"
          AND a."providerId" = 'credential'
          AND a."password" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Every super admin must have a credential password before the MFA redesign can be deployed';
  END IF;
END
$$;

DELETE FROM "Account" a
USING "User" u
WHERE a."userId" = u."id"
  AND u."isSuperAdmin" = true
  AND a."providerId" <> 'credential';

WITH ranked_factors AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY verified DESC, id
    ) AS rank
  FROM "TwoFactor"
)
DELETE FROM "TwoFactor" tf
USING ranked_factors ranked
WHERE tf.id = ranked.id
  AND ranked.rank > 1;

UPDATE "User" u
SET "twoFactorEnabled" = EXISTS (
  SELECT 1
  FROM "TwoFactor" tf
  WHERE tf."userId" = u."id"
    AND tf."verified" = true
);

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
  "twoFactorEnabled"
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
)
EXECUTE FUNCTION bump_user_security_generation_on_state_change();

DROP INDEX IF EXISTS "TwoFactor_userId_idx";
