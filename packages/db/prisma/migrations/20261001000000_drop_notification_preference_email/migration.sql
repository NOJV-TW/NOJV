-- expand-contract-ok: the column is unset in production and no code in this
-- release reads it; a release with migrations drains web and workers before
-- migrating, so no old pod queries it. Rolling back past this release needs a
-- forward fix instead.
ALTER TABLE "NotificationPreference" DROP COLUMN "email";
