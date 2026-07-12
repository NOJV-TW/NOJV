CREATE TABLE "RegistryCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistryCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegistryCredential_userId_key" ON "RegistryCredential"("userId");

CREATE UNIQUE INDEX "RegistryCredential_username_key" ON "RegistryCredential"("username");

ALTER TABLE "RegistryCredential" ADD CONSTRAINT "RegistryCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
