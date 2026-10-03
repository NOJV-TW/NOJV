ALTER TABLE "User" ADD COLUMN "imageInventoryComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "avatarInventoryComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Problem" ADD COLUMN "imageInventoryComplete" BOOLEAN NOT NULL DEFAULT false;
CREATE TYPE "UploadedImageKind" AS ENUM ('problem', 'content', 'avatar');
CREATE TABLE "UploadedImage" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "kind" "UploadedImageKind" NOT NULL,
  "ready" BOOLEAN NOT NULL DEFAULT false,
  "cleanupStarted" BOOLEAN NOT NULL DEFAULT false,
  "userId" TEXT,
  "problemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadedImage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UploadedImage_owner_check" CHECK (("kind" = 'problem' AND "problemId" IS NOT NULL AND "userId" IS NULL) OR ("kind" IN ('content', 'avatar') AND "userId" IS NOT NULL AND "problemId" IS NULL)),
  CONSTRAINT "UploadedImage_size_check" CHECK ("size" >= 0),
  CONSTRAINT "UploadedImage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UploadedImage_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UploadedImage_userId_key_key" ON "UploadedImage"("userId", "key");
CREATE UNIQUE INDEX "UploadedImage_problemId_key_key" ON "UploadedImage"("problemId", "key");
CREATE INDEX "UploadedImage_key_ready_idx" ON "UploadedImage"("key", "ready");
CREATE INDEX "UploadedImage_userId_kind_ready_idx" ON "UploadedImage"("userId", "kind", "ready");
