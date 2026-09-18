import { accountRepo } from "@nojv/db";
import { z } from "zod";

const claimsSchema = z.object({ email: z.email() });

export function emailFromIdToken(idToken: string | null): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = claimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return claims.success ? claims.data.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function listLinkedAccountEmails(userId: string): Promise<Record<string, string>> {
  const rows = await accountRepo.listOAuthIdTokens(userId);
  const emails: Record<string, string> = {};
  for (const row of rows) {
    const email = emailFromIdToken(row.idToken);
    if (email) emails[`${row.providerId}:${row.accountId}`] = email;
  }
  return emails;
}
