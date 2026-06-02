-- AlterTable
ALTER TABLE "Editorial" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "EditorialVote" (
    "id" TEXT NOT NULL,
    "editorialId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EditorialVote_editorialId_userId_key" ON "EditorialVote"("editorialId", "userId");

-- CreateIndex
CREATE INDEX "EditorialVote_editorialId_idx" ON "EditorialVote"("editorialId");

-- AddForeignKey
ALTER TABLE "EditorialVote" ADD CONSTRAINT "EditorialVote_editorialId_fkey" FOREIGN KEY ("editorialId") REFERENCES "Editorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialVote" ADD CONSTRAINT "EditorialVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
