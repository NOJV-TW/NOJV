-- Convert Contest.ipViolationMode and CourseAssessment.ipViolationMode from
-- plain TEXT to a Prisma enum. The application code has always used only two
-- literal values ("block", "notify") — making it an enum enforces that at
-- the DB layer and in the generated Prisma client types.
--
-- The conversion is safe because every existing row must already hold one
-- of the enum values (it has been validated at the application layer since
-- the IP lock feature landed). The CAST below would fail loudly if any
-- stray value existed.

-- 1. Create the enum type.
CREATE TYPE "IpViolationMode" AS ENUM ('block', 'notify');

-- 2. Drop the old defaults so PostgreSQL lets us change the column type.
ALTER TABLE "Contest" ALTER COLUMN "ipViolationMode" DROP DEFAULT;
ALTER TABLE "CourseAssessment" ALTER COLUMN "ipViolationMode" DROP DEFAULT;

-- 3. Convert the columns. USING cast handles the text → enum rewrite.
ALTER TABLE "Contest"
  ALTER COLUMN "ipViolationMode" TYPE "IpViolationMode"
  USING "ipViolationMode"::"IpViolationMode";

ALTER TABLE "CourseAssessment"
  ALTER COLUMN "ipViolationMode" TYPE "IpViolationMode"
  USING "ipViolationMode"::"IpViolationMode";

-- 4. Re-set the defaults, now as enum literals.
ALTER TABLE "Contest"
  ALTER COLUMN "ipViolationMode" SET DEFAULT 'block'::"IpViolationMode";
ALTER TABLE "CourseAssessment"
  ALTER COLUMN "ipViolationMode" SET DEFAULT 'block'::"IpViolationMode";
