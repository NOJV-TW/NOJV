-- Placeholder user mechanism (spec §5.3).
--
-- Teachers bulk-paste course-member handles. Unknown handles get
-- a `User` row in `pending_first_login` so the student can auto-merge
-- into that row on first OAuth login.
--
-- The existing `User.username` column (added by better-auth's
-- `username` plugin) already stores the course-member handle, so no
-- new handle column is needed. This migration only adds the
-- `UserStatus` enum and `User.status` column. The pre-existing
-- `User.disabled: Boolean` flag stays as the admin-visible soft lock;
-- `status` is orthogonal and tracks the placeholder lifecycle.

CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled', 'pending_first_login');

ALTER TABLE "User"
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'active';
