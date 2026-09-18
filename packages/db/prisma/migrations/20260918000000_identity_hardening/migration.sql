BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "User" ADD COLUMN "schoolEmail" TEXT,
ADD COLUMN "schoolVerifiedAt" TIMESTAMP(3);

ALTER TABLE "SchoolVerificationToken" ADD COLUMN "email" TEXT;

ALTER TABLE "NotificationPreference" ADD COLUMN "email" TEXT;

-- Step 1: accounts whose login email is exactly <student id>@<that school's domain>.
UPDATE "User"
SET "schoolEmail" = lower("email")
WHERE "schoolEmail" IS NULL
  AND (
    ("username" ~ '^[0-9]{8}[a-z]$'
      AND lower(split_part("email", '@', 1)) = "username"
      AND lower(split_part("email", '@', 2)) IN ('ntnu.edu.tw', 'gapps.ntnu.edu.tw'))
    OR ("username" ~ '^ntu_[a-z][0-9]{8}$'
      AND lower(split_part("email", '@', 1)) = substr("username", 5)
      AND lower(split_part("email", '@', 2)) IN ('ntu.edu.tw', 'g.ntu.edu.tw'))
    OR ("username" ~ '^ntust_[a-z][0-9]{8}$'
      AND lower(split_part("email", '@', 1)) = substr("username", 7)
      AND lower(split_part("email", '@', 2)) IN ('mail.ntust.edu.tw', 'gapps.ntust.edu.tw'))
  );

-- Step 2: verified accounts whose linked Google account is the school one, read from
-- the id_token email claim. When the login email was later changed to a personal
-- address, keep that address as the notification email and restore the school
-- address as the login email. Skipped when another account already holds it.
DO $$
DECLARE
  acct RECORD;
  claim TEXT;
  expected TEXT;
  payload TEXT;
BEGIN
  FOR acct IN
    SELECT a."userId", a."idToken", u."username", lower(u."email") AS current_email
    FROM "Account" a JOIN "User" u ON u."id" = a."userId"
    WHERE a."providerId" = 'google' AND a."idToken" LIKE 'eyJ%'
      AND u."schoolEmail" IS NULL AND u."disabled" = false
      AND (u."username" ~ '^[0-9]{8}[a-z]$' OR u."username" ~ '^(ntu|ntust)_[a-z][0-9]{8}$')
    ORDER BY a."userId", a."updatedAt" DESC
  LOOP
    BEGIN
      payload := split_part(acct."idToken", '.', 2);
      payload := rpad(translate(payload, '-_', '+/'), (length(payload) + 3) / 4 * 4, '=');
      claim := lower((convert_from(decode(payload, 'base64'), 'UTF8')::jsonb) ->> 'email');
    EXCEPTION WHEN OTHERS THEN
      claim := NULL;
    END;
    CONTINUE WHEN claim IS NULL;

    expected := CASE
      WHEN acct."username" ~ '^[0-9]{8}[a-z]$' THEN acct."username"
      WHEN acct."username" ~ '^ntu_' THEN substr(acct."username", 5)
      ELSE substr(acct."username", 7)
    END;
    CONTINUE WHEN split_part(claim, '@', 1) <> expected;
    CONTINUE WHEN NOT (
      (acct."username" ~ '^[0-9]{8}[a-z]$' AND split_part(claim, '@', 2) IN ('ntnu.edu.tw', 'gapps.ntnu.edu.tw'))
      OR (acct."username" ~ '^ntu_' AND split_part(claim, '@', 2) IN ('ntu.edu.tw', 'g.ntu.edu.tw'))
      OR (acct."username" ~ '^ntust_' AND split_part(claim, '@', 2) IN ('mail.ntust.edu.tw', 'gapps.ntust.edu.tw'))
    );
    CONTINUE WHEN EXISTS (SELECT 1 FROM "User" o WHERE lower(o."email") = claim AND o."id" <> acct."userId");

    IF acct.current_email <> claim THEN
      INSERT INTO "NotificationPreference" ("userId", "email")
      VALUES (acct."userId", acct.current_email)
      ON CONFLICT ("userId") DO UPDATE SET "email" = COALESCE("NotificationPreference"."email", EXCLUDED."email");
    END IF;
    UPDATE "User" SET "schoolEmail" = claim, "email" = claim WHERE "id" = acct."userId";
  END LOOP;
END $$;

COMMIT;
