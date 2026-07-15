DROP TRIGGER IF EXISTS registry_credential_security_generation_membership_change ON "RegistryCredential";
CREATE TRIGGER registry_credential_security_generation_membership_change
AFTER INSERT OR DELETE ON "RegistryCredential"
FOR EACH ROW
EXECUTE FUNCTION bump_security_generation_for_related_user();

DROP TRIGGER IF EXISTS registry_credential_security_generation_credential_change ON "RegistryCredential";
CREATE TRIGGER registry_credential_security_generation_credential_change
AFTER UPDATE OF "userId", "username", "passwordHash" ON "RegistryCredential"
FOR EACH ROW
WHEN (
  OLD."userId" IS DISTINCT FROM NEW."userId"
  OR OLD."username" IS DISTINCT FROM NEW."username"
  OR OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash"
)
EXECUTE FUNCTION bump_security_generation_for_related_user();
