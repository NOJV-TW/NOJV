UPDATE "Contest" SET "inviteCode" = NULL WHERE "inviteCode" ~ '^[0-9a-f]{8}$';
