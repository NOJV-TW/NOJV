BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "User" ADD COLUMN "schoolEmail" TEXT,
ADD COLUMN "schoolVerifiedAt" TIMESTAMP(3);

ALTER TABLE "SchoolVerificationToken" ADD COLUMN "email" TEXT;

ALTER TABLE "NotificationPreference" ADD COLUMN "email" TEXT,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Record the proving address for accounts verified before the column existed.
-- Only rows whose primary email is exactly <student id>@<that school's domain>
-- are attributable; every other verified account keeps schoolEmail NULL and
-- schoolVerifiedAt stays NULL for all backfilled rows.
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

COMMIT;
