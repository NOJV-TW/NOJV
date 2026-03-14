-- AlterTable
ALTER TABLE "Contest" ADD COLUMN     "inviteCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contest_inviteCode_key" ON "Contest"("inviteCode");

-- RenameIndex
ALTER INDEX "User_handle_key" RENAME TO "User_username_key";
