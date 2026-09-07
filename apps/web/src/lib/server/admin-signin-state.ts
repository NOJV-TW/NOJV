import { userDomain } from "@nojv/application";
import { createAuthEndpoint } from "better-auth/api";

import { getAuth } from "$lib/auth.server";

const readPendingSignIn = createAuthEndpoint({ method: "GET" }, async (ctx) => {
  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const verification = await ctx.context.internalAdapter.findVerificationValue(identifier);
  if (!verification || new Date(verification.expiresAt).getTime() <= Date.now()) return null;
  const user = await userDomain.getUserById(verification.value);
  return user?.platformRole === "admin" && !user.isSuperAdmin && !user.disabled
    ? user.id
    : null;
});

export async function pendingRegularAdminSignIn(headers: Headers): Promise<string | null> {
  return readPendingSignIn({ headers, context: await getAuth().$context });
}
