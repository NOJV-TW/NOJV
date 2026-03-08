-- AlterTable
ALTER TABLE "Problem" ALTER COLUMN "summary" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT;
