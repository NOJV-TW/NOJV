-- AlterTable
ALTER TABLE "Problem" ADD COLUMN     "advancedRequiredPaths" TEXT[] DEFAULT ARRAY[]::TEXT[];
