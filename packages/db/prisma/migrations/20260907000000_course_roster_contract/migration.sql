-- expand-contract-ok: deploy-expand.sh stops at the older storage contract;
-- deploy-release.sh exposes this migration only after all three writers and
-- autoscalers are drained. Contract failure requires a compatible forward fix.
BEGIN;

LOCK TABLE "User", "CourseMembership", "ScoreOverride", "SubmissionFeedback",
  "ScoreOverrideAuditLog", "SubmissionFeedbackAuditLog" IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE course_roster_pending_users ON COMMIT DROP AS
SELECT * FROM "User" WHERE "status" = 'pending_first_login';

CREATE TEMP TABLE course_roster_pending_memberships ON COMMIT DROP AS
SELECT m.* FROM "CourseMembership" m
JOIN course_roster_pending_users u ON u."id" = m."userId";

DO $$
DECLARE
  reference RECORD;
  referenced_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User"
    WHERE lower("email") LIKE '%@placeholder.nojv.local'
      AND "status" <> 'pending_first_login'
  ) OR EXISTS (
    SELECT 1 FROM course_roster_pending_users
    WHERE "username" IS NULL OR "username" !~ '^[a-z0-9._-]{3,64}$'
      OR "email" <> 'placeholder+' || "username" || '@placeholder.nojv.local'
      OR "emailVerified" OR "disabled" OR "isSuperAdmin" OR "platformRole" <> 'student'
      OR "mustChangePassword" OR "twoFactorEnabled"
  ) THEN
    RAISE EXCEPTION 'Course roster preflight: invalid placeholder identity/status';
  END IF;

  -- Inspect every FK, including future tables and non-id User references.
  FOR reference IN
    SELECT c.conrelid, c.conname, n.nspname, t.relname,
      array_agg(a.attname::text ORDER BY k.ordinality) AS columns,
      array_agg(b.attname::text ORDER BY k.ordinality) AS target_columns,
      string_agg(format('r.%I = u.%I', a.attname, b.attname), ' AND '
        ORDER BY k.ordinality) AS predicate
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY
      AS k(source_number, target_number, ordinality)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.source_number
    JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = k.target_number
    WHERE c.contype = 'f' AND c.confrelid = '"User"'::regclass
    GROUP BY c.conrelid, c.conname, n.nspname, t.relname
    ORDER BY n.nspname, t.relname, c.conname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I r JOIN course_roster_pending_users u ON %s',
      reference.nspname, reference.relname, reference.predicate
    ) INTO referenced_count;
    RAISE NOTICE 'Course roster pending FK inventory: %.% (%) = %',
      reference.nspname, reference.relname, reference.conname, referenced_count;
    IF referenced_count > 0 AND NOT (
      reference.target_columns = ARRAY['id']::text[] AND (
        (reference.conrelid = '"CourseMembership"'::regclass
          AND reference.columns = ARRAY['userId']::text[])
        OR (reference.conrelid = '"ScoreOverride"'::regclass
          AND reference.columns = ARRAY['userId']::text[])
        OR (reference.conrelid = '"SubmissionFeedback"'::regclass
          AND reference.columns = ARRAY['studentUserId']::text[])
      )
    ) THEN
      RAISE EXCEPTION 'Course roster preflight: unexpected pending User reference %.% (%)',
        reference.nspname, reference.relname, reference.conname;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM "ScoreOverride" s
    JOIN course_roster_pending_users u ON u."id" = s."userId"
    WHERE s."contextType" = 'contest'
  ) THEN
    RAISE EXCEPTION 'Course roster preflight: pending User has contest scores';
  END IF;
END;
$$;

ALTER TABLE "CourseMembership" ADD COLUMN "pendingUsername" TEXT;
ALTER TABLE "CourseMembership" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "CourseMembership" DROP CONSTRAINT "CourseMembership_userId_fkey";
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScoreOverride" ADD COLUMN "courseMembershipId" TEXT;
ALTER TABLE "ScoreOverride" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "SubmissionFeedback" ADD COLUMN "courseMembershipId" TEXT;

ALTER TYPE "ScoreOverrideAction" ADD VALUE 'merge';
ALTER TYPE "SubmissionFeedbackAction" ADD VALUE 'merge';
ALTER TABLE "ScoreOverrideAuditLog"
  ADD COLUMN "courseMembershipId" TEXT,
  ADD COLUMN "sourceMembershipId" TEXT,
  ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "SubmissionFeedbackAuditLog"
  ADD COLUMN "courseMembershipId" TEXT,
  ADD COLUMN "sourceMembershipId" TEXT,
  ALTER COLUMN "studentUserId" DROP NOT NULL;

UPDATE "ScoreOverride" s
SET "courseMembershipId" = m."id"
FROM "CourseMembership" m, "Assessment" a
WHERE s."contextType" = 'assignment' AND s."contextId" = a."id"
  AND m."courseId" = a."courseId" AND m."userId" = s."userId";

UPDATE "ScoreOverride" s
SET "courseMembershipId" = m."id"
FROM "CourseMembership" m, "Exam" e
WHERE s."contextType" = 'exam' AND s."contextId" = e."id"
  AND m."courseId" = e."courseId" AND m."userId" = s."userId";

UPDATE "SubmissionFeedback" f
SET "courseMembershipId" = m."id"
FROM "CourseMembership" m, "Assessment" a
WHERE f."assessmentId" = a."id"
  AND m."courseId" = a."courseId" AND m."userId" = f."studentUserId";

UPDATE "SubmissionFeedback" f
SET "courseMembershipId" = m."id"
FROM "CourseMembership" m, "Exam" e
WHERE f."examId" = e."id"
  AND m."courseId" = e."courseId" AND m."userId" = f."studentUserId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ScoreOverride" s
    WHERE (s."contextType" IN ('assignment', 'exam') AND s."courseMembershipId" IS NULL)
      OR (s."contextType" = 'contest' AND NOT EXISTS (
        SELECT 1 FROM "Contest" c WHERE c."id" = s."contextId"
      ))
  ) OR EXISTS (
    SELECT 1 FROM "SubmissionFeedback" WHERE "courseMembershipId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Course roster preflight: unmappable live grading subject/context';
  END IF;
END;
$$;

-- Audit identity fields are historical snapshots, not live User foreign keys.
-- Deleted contexts may no longer map to a membership; keep their snapshots.
UPDATE "ScoreOverrideAuditLog" l
SET "courseMembershipId" = s."courseMembershipId",
    "sourceMembershipId" = s."courseMembershipId"
FROM "ScoreOverride" s WHERE l."overrideId" = s."id";

UPDATE "ScoreOverrideAuditLog" l
SET "courseMembershipId" = m."id", "sourceMembershipId" = m."id"
FROM "CourseMembership" m, "Assessment" a
WHERE l."courseMembershipId" IS NULL AND l."contextType" = 'assignment'
  AND l."contextId" = a."id" AND m."courseId" = a."courseId" AND m."userId" = l."userId";

UPDATE "ScoreOverrideAuditLog" l
SET "courseMembershipId" = m."id", "sourceMembershipId" = m."id"
FROM "CourseMembership" m, "Exam" e
WHERE l."courseMembershipId" IS NULL AND l."contextType" = 'exam'
  AND l."contextId" = e."id" AND m."courseId" = e."courseId" AND m."userId" = l."userId";

UPDATE "SubmissionFeedbackAuditLog" l
SET "courseMembershipId" = f."courseMembershipId",
    "sourceMembershipId" = f."courseMembershipId"
FROM "SubmissionFeedback" f WHERE l."feedbackId" = f."id";

UPDATE "SubmissionFeedbackAuditLog" l
SET "courseMembershipId" = m."id", "sourceMembershipId" = m."id"
FROM "CourseMembership" m, "Assessment" a
WHERE l."courseMembershipId" IS NULL AND l."assessmentId" = a."id"
  AND m."courseId" = a."courseId" AND m."userId" = l."studentUserId";

UPDATE "SubmissionFeedbackAuditLog" l
SET "courseMembershipId" = m."id", "sourceMembershipId" = m."id"
FROM "CourseMembership" m, "Exam" e
WHERE l."courseMembershipId" IS NULL AND l."examId" = e."id"
  AND m."courseId" = e."courseId" AND m."userId" = l."studentUserId";

UPDATE "ScoreOverride" SET "userId" = NULL WHERE "contextType" IN ('assignment', 'exam');
ALTER TABLE "SubmissionFeedback" DROP COLUMN "studentUserId";
ALTER TABLE "SubmissionFeedback" ALTER COLUMN "courseMembershipId" SET NOT NULL;

UPDATE "CourseMembership" m
SET "pendingUsername" = u."username", "userId" = NULL
FROM course_roster_pending_users u WHERE m."userId" = u."id";

ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_identity_chk"
  CHECK (("userId" IS NOT NULL) <> ("pendingUsername" IS NOT NULL));
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_pending_username_chk"
  CHECK ("pendingUsername" IS NULL OR (
    "pendingUsername" ~ '^[a-z0-9._-]{3,64}$'
  ));
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_courseId_pendingUsername_key"
  UNIQUE ("courseId", "pendingUsername");

ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_subject_chk"
  CHECK (
    ("contextType" = 'contest' AND "userId" IS NOT NULL AND "courseMembershipId" IS NULL)
    OR ("contextType" IN ('assignment', 'exam') AND "userId" IS NULL AND "courseMembershipId" IS NOT NULL)
  );
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_courseMembershipId_fkey"
  FOREIGN KEY ("courseMembershipId") REFERENCES "CourseMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_courseMembershipId_problemId_contextType_cont_key"
  UNIQUE ("courseMembershipId", "problemId", "contextType", "contextId");
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_courseMembershipId_fkey"
  FOREIGN KEY ("courseMembershipId") REFERENCES "CourseMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_assessmentId_problemId_courseMembershipI_key"
  UNIQUE ("assessmentId", "problemId", "courseMembershipId");
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_examId_problemId_courseMembershipId_key"
  UNIQUE ("examId", "problemId", "courseMembershipId");

DELETE FROM "User" u USING course_roster_pending_users p
WHERE u."id" = p."id" AND u."status" = 'pending_first_login'
  AND u."username" = p."username" AND u."email" = p."email";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "status" = 'pending_first_login') THEN
    RAISE EXCEPTION 'Course roster postflight: placeholder Users remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM course_roster_pending_memberships old
    JOIN course_roster_pending_users u ON u."id" = old."userId"
    LEFT JOIN "CourseMembership" m ON m."id" = old."id"
    WHERE m."id" IS NULL OR m."userId" IS NOT NULL OR m."pendingUsername" IS DISTINCT FROM u."username"
      OR (to_jsonb(m) - 'userId' - 'pendingUsername') IS DISTINCT FROM (to_jsonb(old) - 'userId')
  ) THEN
    RAISE EXCEPTION 'Course roster postflight: membership identity/attributes changed';
  END IF;
END;
$$;

DROP TRIGGER user_security_generation_state_change ON "User";
ALTER TABLE "User" DROP COLUMN "status";
DROP TYPE "UserStatus";
CREATE TRIGGER user_security_generation_state_change
BEFORE UPDATE OF "email", "emailVerified", "platformRole", "isSuperAdmin", "disabled",
  "mustChangePassword", "twoFactorEnabled" ON "User"
FOR EACH ROW
WHEN (
  OLD."email" IS DISTINCT FROM NEW."email"
  OR OLD."emailVerified" IS DISTINCT FROM NEW."emailVerified"
  OR OLD."platformRole" IS DISTINCT FROM NEW."platformRole"
  OR OLD."isSuperAdmin" IS DISTINCT FROM NEW."isSuperAdmin"
  OR OLD."disabled" IS DISTINCT FROM NEW."disabled"
  OR OLD."mustChangePassword" IS DISTINCT FROM NEW."mustChangePassword"
  OR OLD."twoFactorEnabled" IS DISTINCT FROM NEW."twoFactorEnabled"
)
EXECUTE FUNCTION bump_user_security_generation_on_state_change();

COMMIT;
