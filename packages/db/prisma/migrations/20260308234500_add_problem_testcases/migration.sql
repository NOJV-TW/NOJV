ALTER TABLE "TestcaseSet"
DROP COLUMN "storagePath";

CREATE TABLE "Testcase" (
    "id" TEXT NOT NULL,
    "testcaseSetId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "stdin" TEXT NOT NULL,
    "expectedStdout" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testcase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestcaseSet_problemId_name_key"
ON "TestcaseSet"("problemId", "name");

CREATE UNIQUE INDEX "Testcase_testcaseSetId_ordinal_key"
ON "Testcase"("testcaseSetId", "ordinal");

ALTER TABLE "Testcase"
ADD CONSTRAINT "Testcase_testcaseSetId_fkey"
FOREIGN KEY ("testcaseSetId") REFERENCES "TestcaseSet"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
