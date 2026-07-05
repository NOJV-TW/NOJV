-- Problems get their public displayId ("#N") only when published, not at
-- creation. A draft therefore has no displayId until it is published, at which
-- point it is assigned max(displayId)+1. Make displayId nullable, drop the
-- autoincrement default, and retire its sequence. Existing rows keep their ids.
ALTER TABLE "Problem" ALTER COLUMN "displayId" DROP DEFAULT;
ALTER TABLE "Problem" ALTER COLUMN "displayId" DROP NOT NULL;
DROP SEQUENCE IF EXISTS "Problem_displayId_seq";
