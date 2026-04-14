-- Drop CourseJoinToken FK + column on CourseMembership first, then the table and its enum.
ALTER TABLE "CourseMembership" DROP CONSTRAINT IF EXISTS "CourseMembership_joinedTokenId_fkey";
ALTER TABLE "CourseMembership" DROP COLUMN IF EXISTS "joinedTokenId";

DROP TABLE IF EXISTS "CourseJoinToken" CASCADE;
DROP TYPE IF EXISTS "CourseJoinTokenKind";

-- Drop the Course.slug unique index, the slug column, visibility column,
-- locale column, and the CourseVisibility enum that only the dropped
-- column referenced.
DROP INDEX IF EXISTS "Course_slug_key";
ALTER TABLE "Course" DROP COLUMN IF EXISTS "slug";
ALTER TABLE "Course" DROP COLUMN IF EXISTS "visibility";
ALTER TABLE "Course" DROP COLUMN IF EXISTS "locale";
DROP TYPE IF EXISTS "CourseVisibility";
