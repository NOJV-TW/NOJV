UPDATE "Account"
SET "accessToken" = NULL,
    "refreshToken" = NULL,
    "accessTokenExpiresAt" = NULL,
    "refreshTokenExpiresAt" = NULL
WHERE "providerId" <> 'credential'
  AND ("accessToken" IS NOT NULL OR "refreshToken" IS NOT NULL);
