# BetterAuth Migration Design

## Summary

Migrate authentication from NextAuth v5 (JWT strategy) to BetterAuth with GitHub and Google OAuth support.

## Decisions

| Decision | Choice |
|----------|--------|
| BetterAuth table management | Official default (BetterAuth manages auth tables) |
| Login methods | Email/password + GitHub + Google OAuth |
| OAuth handle | Auto-derive from provider, changeable later |
| Account linking | Auto-link by same email |
| Email verification | Required for email/password registration |
| Dev header fallback | Keep (development only) |
| Middleware | Delete (deprecated in Next.js 16, redundant with per-route checks) |

## Schema Changes

### Modify `User` model

- Remove `passwordHash` (BetterAuth stores in `account` table)
- Add `emailVerified Boolean @default(false)`
- Add `image String?`
- All existing relations unchanged

### New BetterAuth tables

- `Account` — OAuth accounts + credential passwords (providerId, accountId, password, etc.)
- `Session` — Server-side sessions (token, expiresAt, ipAddress, userAgent)
- `Verification` — Email verification tokens

Note: BetterAuth uses server-side sessions (stored in DB), not JWT.

## File Changes

### Delete

- `apps/web/src/auth.ts` — NextAuth config
- `apps/web/src/app/api/auth/[...nextauth]/route.ts` — NextAuth route handler
- `apps/web/src/app/api/auth/register/route.ts` — Manual registration (BetterAuth handles it)
- `apps/web/src/components/auth-session-provider.tsx` — NextAuth SessionProvider wrapper
- `apps/web/src/middleware.ts` — Deprecated, redundant with per-route auth checks

### Create

- `apps/web/src/lib/auth.ts` — BetterAuth server config
- `apps/web/src/lib/auth-client.ts` — BetterAuth client instance
- `apps/web/src/app/api/auth/[...all]/route.ts` — BetterAuth catch-all route handler

### Modify

- `packages/db/prisma/schema.prisma` — User field changes + new Account/Session/Verification models
- `apps/web/src/lib/server/actor-context.ts` — Use BetterAuth session API
- `apps/web/src/app/layout.tsx` — Remove AuthSessionProvider wrapper
- `apps/web/src/app/[locale]/submissions/page.tsx` — Use BetterAuth server session
- `apps/web/src/components/user-auth-menu.tsx` — Use BetterAuth client API
- `apps/web/src/app/auth/signin/page.tsx` — Use BetterAuth signIn + OAuth buttons
- `apps/web/src/app/auth/signup/page.tsx` — Use BetterAuth signUp + OAuth buttons
- `packages/db/prisma/seed.ts` — Passwords move to Account table
- `apps/web/package.json` — Remove next-auth/bcryptjs, add better-auth

## BetterAuth Server Config

```ts
// apps/web/src/lib/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@nojv/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  user: {
    additionalFields: {
      handle: { type: "string", unique: true, required: true },
      platformRole: { type: "string", defaultValue: "student" },
      locale: { type: "string", defaultValue: "zh-TW" },
    },
  },
  account: { accountLinking: { enabled: true } },
});
```

## BetterAuth Client Config

```ts
// apps/web/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

## Handle Auto-Derivation

On OAuth first login, in `databaseHooks.user.create.before`:

1. GitHub → use GitHub username (e.g. `takala`)
2. Google → use email prefix (e.g. `takala.dev@gmail.com` → `takala-dev`)
3. Collision → append numeric suffix (`takala-1`, `takala-2`)
4. Normalize → lowercase, replace illegal chars with `-`

## actor-context.ts

```ts
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getActorContext(request: Request): Promise<PocActorContext | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (session?.user) {
    return {
      userId: session.user.id,
      email: session.user.email,
      displayName: session.user.name ?? session.user.email,
      handle: session.user.handle ?? "",
      platformRole: parsePlatformRole(session.user.platformRole),
    };
  }

  if (process.env.NODE_ENV === "development") {
    return getActorContextFromHeaders(request);
  }

  return null;
}
```

## Frontend Changes

### signin/page.tsx

- `signIn("credentials", ...)` → `authClient.signIn.email({ email, password })`
- Add GitHub button: `authClient.signIn.social({ provider: "github" })`
- Add Google button: `authClient.signIn.social({ provider: "google" })`

### signup/page.tsx

- Remove `fetch("/api/auth/register")`
- Use `authClient.signUp.email({ name, email, password, handle })`
- Add OAuth buttons (same as signin)

### user-auth-menu.tsx

- `useSession()` from `@/lib/auth-client`
- `signOut()` from `authClient.signOut()`

### submissions/page.tsx

- `await auth()` → `await auth.api.getSession({ headers: await headers() })`

### layout.tsx

- Remove `<AuthSessionProvider>` wrapper (BetterAuth does not need a context provider)

## New Environment Variables

```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
```

## Migration Notes

- Existing users with `passwordHash` need migration: hash moves to `Account` table with `providerId: "credential"`
- Seed script needs update to create Account records instead of setting `passwordHash` on User
- `pnpm db:generate` after schema changes, then `pnpm db:migrate` to apply
