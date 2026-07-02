-- Public/private contests are now distinguished by inviteCode presence.
-- Existing contests were all publicly listed regardless of their (never-surfaced)
-- auto-generated codes, so clear those codes to keep them public.
UPDATE "Contest" SET "inviteCode" = NULL;
