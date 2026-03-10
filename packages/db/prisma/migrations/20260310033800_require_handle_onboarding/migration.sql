-- AlterTable
ALTER TABLE "User"
ALTER COLUMN "handle" DROP NOT NULL,
ADD COLUMN     "displayHandle" TEXT;
