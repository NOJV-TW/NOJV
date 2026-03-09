# BetterAuth Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace NextAuth v5 with BetterAuth, adding GitHub and Google OAuth alongside existing email/password auth.

**Architecture:** BetterAuth manages auth tables (user, session, account, verification) with Prisma adapter. Existing User model adapted to include BetterAuth-expected fields while keeping all domain relations. Server-side sessions replace JWT strategy.

**Tech Stack:** better-auth, Prisma 7, PostgreSQL, Next.js 16, React 19

---

### Task 1: Install dependencies

**Files:**
- Modify: `apps/web/package.json`

**Step 1: Remove NextAuth and bcryptjs, install BetterAuth**

Run:
```bash
cd apps/web && pnpm remove next-auth bcryptjs @types/bcryptjs && pnpm add better-auth
```

**Step 2: Verify install**

Run: `pnpm install` (from root)
Expected: clean install, no errors

**Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore: replace next-auth with better-auth dependency"
```

---

### Task 2: Update Prisma schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

**Step 1: Modify User model and add BetterAuth tables**

In `packages/db/prisma/schema.prisma`, make these changes to the `User` model:

1. Remove `passwordHash String?`
2. Rename `displayName` to `name` (BetterAuth expects `name`)
3. Add `emailVerified Boolean @default(false)`
4. Add `image String?`
5. Keep all existing relations unchanged

Add three new models after `User`:

```prisma
model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Verification {
  id         String    @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime? @default(now())
  updatedAt  DateTime? @updatedAt
}
```

Add relations to `User` model:

```prisma
sessions             Session[]
accounts             Account[]
```

Also update all references to `displayName` throughout the codebase to `name` — search for `displayName` in:
- `packages/db/prisma/seed.ts` (user creation)
- `apps/web/src/lib/server/actor-context.ts` (session mapping)
- `apps/web/src/lib/server/poc-persistence.ts` (ensureUser)
- `apps/web/src/lib/server/persistence-mappers.ts`
- `apps/web/src/app/api/auth/register/route.ts` (will be deleted, skip)
- Any other files referencing `user.displayName`

Note: `PocActorContext` interface keeps `displayName` as its own field name — only the DB/Prisma field changes to `name`.

**Step 2: Generate Prisma client**

Run: `pnpm db:generate`
Expected: Prisma client generated successfully

**Step 3: Create migration**

Run: `cd packages/db && pnpm prisma migrate dev --name betterauth-migration`
Expected: Migration created and applied. Note: this is a destructive migration (removes `passwordHash`, renames `displayName` → `name`). For dev this is fine — we will re-seed.

**Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ packages/db/generated/
git commit -m "feat: update prisma schema for BetterAuth (user fields + session/account/verification tables)"
```

---

### Task 3: Create BetterAuth server config

**Files:**
- Create: `apps/web/src/lib/auth.ts`

**Step 1: Write the server auth config**

```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { prisma } from "@nojv/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!
    }
  },
  user: {
    additionalFields: {
      handle: { type: "string", unique: true, required: true },
      platformRole: { type: "string", defaultValue: "student" },
      locale: { type: "string", defaultValue: "zh-TW" }
    }
  },
  account: {
    accountLinking: { enabled: true }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // If handle already set (email/password signup), keep it
          if (user.handle) {
            return { data: user };
          }

          // Derive handle from name or email
          const base = (user.name ?? user.email.split("@")[0]!)
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60);

          let candidate = base || "user";
          let suffix = 0;

          while (true) {
            const existing = await prisma.user.findUnique({
              where: { handle: candidate }
            });

            if (!existing) break;

            suffix++;
            candidate = `${base}-${String(suffix)}`;
          }

          return {
            data: { ...user, handle: candidate }
          };
        }
      }
    }
  }
});
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/auth.ts
git commit -m "feat: add BetterAuth server config with GitHub/Google OAuth and handle derivation"
```

---

### Task 4: Create BetterAuth client and route handler

**Files:**
- Create: `apps/web/src/lib/auth-client.ts`
- Create: `apps/web/src/app/api/auth/[...all]/route.ts`

**Step 1: Write the client**

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

**Step 2: Write the route handler**

```ts
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

**Step 3: Commit**

```bash
git add apps/web/src/lib/auth-client.ts apps/web/src/app/api/auth/\[...all\]/route.ts
git commit -m "feat: add BetterAuth client and Next.js route handler"
```

---

### Task 5: Delete old auth files

**Files:**
- Delete: `apps/web/src/auth.ts`
- Delete: `apps/web/src/app/api/auth/[...nextauth]/route.ts`
- Delete: `apps/web/src/app/api/auth/register/route.ts`
- Delete: `apps/web/src/components/auth-session-provider.tsx`
- Delete: `apps/web/src/middleware.ts`

**Step 1: Remove old files**

Run:
```bash
rm apps/web/src/auth.ts
rm apps/web/src/app/api/auth/\[...nextauth\]/route.ts
rmdir apps/web/src/app/api/auth/\[...nextauth\]
rm apps/web/src/app/api/auth/register/route.ts
rm apps/web/src/components/auth-session-provider.tsx
rm apps/web/src/middleware.ts
```

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove NextAuth config, middleware, register route, and session provider"
```

---

### Task 6: Update actor-context.ts

**Files:**
- Modify: `apps/web/src/lib/server/actor-context.ts`

**Step 1: Rewrite to use BetterAuth session API**

Replace the entire file with:

```ts
import { headers } from "next/headers";

import { platformRoleSchema, type PlatformRole } from "@nojv/domain";

import { auth } from "@/lib/auth";

export interface PocActorContext {
  displayName: string;
  email: string;
  handle: string;
  platformRole: PlatformRole;
  userId: string;
}

const defaultActorContext: PocActorContext = {
  displayName: "Learner 01",
  email: "learner.01@nojv.local",
  handle: "learner_01",
  platformRole: "student",
  userId: "usr_student_local"
};

function readHeader(reqHeaders: Headers, key: string) {
  const value = reqHeaders.get(key)?.trim();

  return value && value.length > 0 ? value : undefined;
}

function deriveEmail(userId: string) {
  return `${userId.replaceAll(/[^a-z0-9._-]/gi, "-").toLowerCase()}@nojv.local`;
}

function deriveHandle(userId: string) {
  return userId.replaceAll(/[^a-z0-9._-]/gi, "-").toLowerCase();
}

function getActorContextFromHeaders(request: Request): PocActorContext {
  const userId = readHeader(request.headers, "x-nojv-actor-id") ?? defaultActorContext.userId;
  const parsedRole = platformRoleSchema.safeParse(
    readHeader(request.headers, "x-nojv-platform-role") ?? defaultActorContext.platformRole
  );
  const platformRole = parsedRole.success ? parsedRole.data : defaultActorContext.platformRole;

  return {
    displayName: readHeader(request.headers, "x-nojv-display-name") ?? userId,
    email: readHeader(request.headers, "x-nojv-email") ?? deriveEmail(userId),
    handle: readHeader(request.headers, "x-nojv-handle") ?? deriveHandle(userId),
    platformRole,
    userId
  };
}

export async function getActorContext(request: Request): Promise<PocActorContext | null> {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (session?.user) {
    const parsedRole = platformRoleSchema.safeParse(
      (session.user as Record<string, unknown>).platformRole
    );

    return {
      displayName: session.user.name ?? session.user.email,
      email: session.user.email,
      handle: ((session.user as Record<string, unknown>).handle as string) ?? "",
      platformRole: parsedRole.success ? parsedRole.data : "student",
      userId: session.user.id
    };
  }

  if (process.env.NODE_ENV === "development") {
    return getActorContextFromHeaders(request);
  }

  return null;
}
```

Note: BetterAuth's session.user type may not include our custom fields directly. We cast to `Record<string, unknown>` to access `handle` and `platformRole`. Once we confirm BetterAuth's type inference with `additionalFields`, we can remove the cast.

**Step 2: Commit**

```bash
git add apps/web/src/lib/server/actor-context.ts
git commit -m "feat: update actor-context to use BetterAuth session API"
```

---

### Task 7: Update root layout

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

**Step 1: Remove AuthSessionProvider**

Replace file content with:

```tsx
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  description:
    "NOJV is a production-oriented Online Judge skeleton with practice, contest, workspace, and integrity surfaces.",
  title: "NOJV"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "chore: remove AuthSessionProvider from root layout"
```

---

### Task 8: Update user-auth-menu.tsx

**Files:**
- Modify: `apps/web/src/components/user-auth-menu.tsx`

**Step 1: Rewrite to use BetterAuth client**

```tsx
"use client";

import Link from "next/link";

import { shellClassNames } from "@nojv/ui";

import { authClient } from "@/lib/auth-client";

export function UserAuthMenu() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="rounded-full border border-[color:var(--color-border)] bg-white/60 px-4 py-2 text-sm text-[color:var(--color-muted)]">
        ...
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2">
        <span className={`${shellClassNames.badge} max-w-[10rem] truncate`}>
          {session.user.name ?? session.user.email}
        </span>
        <button
          className="rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-sm transition hover:-translate-y-0.5 hover:bg-white/70"
          onClick={() => void authClient.signOut()}
          type="button"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Link
        className="rounded-full border border-[color:var(--color-border)] px-4 py-2 transition hover:-translate-y-0.5 hover:bg-white/70"
        href="/auth/signin"
      >
        Sign in
      </Link>
      <Link
        className="rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-white transition hover:-translate-y-0.5"
        href="/auth/signup"
      >
        Sign up
      </Link>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/user-auth-menu.tsx
git commit -m "feat: update user-auth-menu to use BetterAuth client"
```

---

### Task 9: Update signin page

**Files:**
- Modify: `apps/web/src/app/auth/signin/page.tsx`

**Step 1: Rewrite with BetterAuth + OAuth buttons**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);

    const { error: signInError } = await authClient.signIn.email({
      email: form.get("email") as string,
      password: form.get("password") as string
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message ?? "Invalid email or password.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: "/", provider });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg)]">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-6 text-center text-2xl font-semibold">Sign in to NOJV</h1>

        <div className="flex flex-col gap-3">
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("github")}
            type="button"
          >
            GitHub
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("google")}
            type="button"
          >
            Google
          </button>
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-[color:var(--color-muted)]">
          <hr className="flex-1 border-[color:var(--color-border)]" />
          or
          <hr className="flex-1 border-[color:var(--color-border)]" />
        </div>

        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              autoComplete="email"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="email"
              required
              type="email"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              autoComplete="current-password"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="password"
              required
              type="password"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            className="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[color:var(--color-muted)]">
          Don&apos;t have an account?{" "}
          <Link className="text-[color:var(--color-accent)] underline" href="/auth/signup">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/auth/signin/page.tsx
git commit -m "feat: update signin page with BetterAuth + GitHub/Google OAuth buttons"
```

---

### Task 10: Update signup page

**Files:**
- Modify: `apps/web/src/app/auth/signup/page.tsx`

**Step 1: Rewrite with BetterAuth signUp + OAuth buttons**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);

    const { error: signUpError } = await authClient.signUp.email({
      email: form.get("email") as string,
      handle: form.get("handle") as string,
      name: form.get("displayName") as string,
      password: form.get("password") as string
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message ?? "Registration failed.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: "/", provider });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg)]">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-6 text-center text-2xl font-semibold">Create your NOJV account</h1>

        <div className="flex flex-col gap-3">
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("github")}
            type="button"
          >
            GitHub
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("google")}
            type="button"
          >
            Google
          </button>
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-[color:var(--color-muted)]">
          <hr className="flex-1 border-[color:var(--color-border)]" />
          or
          <hr className="flex-1 border-[color:var(--color-border)]" />
        </div>

        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="flex flex-col gap-1 text-sm">
            Display name
            <input
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="displayName"
              required
              type="text"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Handle
            <input
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="handle"
              pattern="[a-z0-9._-]{3,64}"
              required
              title="3-64 characters, lowercase letters, digits, dots, hyphens, underscores"
              type="text"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              autoComplete="email"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="email"
              required
              type="email"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              autoComplete="new-password"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            className="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? "Creating account..." : "Sign up"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[color:var(--color-muted)]">
          Already have an account?{" "}
          <Link className="text-[color:var(--color-accent)] underline" href="/auth/signin">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/auth/signup/page.tsx
git commit -m "feat: update signup page with BetterAuth + GitHub/Google OAuth buttons"
```

---

### Task 11: Update submissions page

**Files:**
- Modify: `apps/web/src/app/[locale]/submissions/page.tsx`

**Step 1: Replace auth import**

Change:
```ts
import { auth } from "@/auth";
```
to:
```ts
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
```

Change:
```ts
const session = await auth();

if (!session?.user?.id) {
```
to:
```ts
const session = await auth.api.getSession({ headers: await headers() });

if (!session?.user?.id) {
```

The rest of the file stays the same — `session.user.id` and `session.user.name`/`session.user.email` work the same way in BetterAuth.

**Step 2: Commit**

```bash
git add apps/web/src/app/\[locale\]/submissions/page.tsx
git commit -m "feat: update submissions page to use BetterAuth session"
```

---

### Task 12: Update displayName → name references

**Files:**
- Modify: any files referencing `user.displayName` or `displayName` as a Prisma field

Search for all files using `displayName` as a Prisma/DB field (not the `PocActorContext.displayName` which stays):

- `packages/db/prisma/seed.ts` — change `displayName` key in user creation to `name`
- `apps/web/src/lib/server/poc-persistence.ts` — change `displayName` to `name` in Prisma queries
- `apps/web/src/lib/server/persistence-mappers.ts` — change `displayName` to `name` in Prisma result mapping
- `apps/web/src/lib/server/read-model.ts` — if it references `user.displayName`

For each file: replace `displayName` with `name` ONLY where it refers to the Prisma User model field. Keep `displayName` where it refers to `PocActorContext.displayName` or the `@nojv/domain` `ActorIdentity.displayName`.

**Step 1: Update seed.ts**

In `packages/db/prisma/seed.ts`, change all `displayName:` in `userDefs` to `name:`.

**Step 2: Update poc-persistence.ts and persistence-mappers.ts**

Search these files for `displayName` used in Prisma queries and change to `name`.

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors related to `displayName` on Prisma User model

**Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts apps/web/src/lib/server/
git commit -m "refactor: rename User.displayName to User.name for BetterAuth compatibility"
```

---

### Task 13: Update seed script for Account table

**Files:**
- Modify: `packages/db/prisma/seed.ts`

**Step 1: Update seed to create Account records for passwords**

Instead of setting `passwordHash` on User, create an Account record with `providerId: "credential"` and `password` field (bcrypt hash).

BetterAuth stores credential passwords in the `account` table. Update the seed:

1. Remove `passwordHash` from user creation
2. After creating users, create Account records:

```ts
import { randomUUID } from "node:crypto";

// After users are created:
await Promise.all(
  users.map((u) =>
    prisma.account.upsert({
      where: { id: `acct_${u.handle}` },
      update: { password: passwordHash },
      create: {
        id: `acct_${u.handle}`,
        accountId: u.id,
        providerId: "credential",
        userId: u.id,
        password: passwordHash
      }
    })
  )
);
```

Note: Keep `bcryptjs` import in seed.ts — it's a direct dependency of `@nojv/db`, not `@nojv/web`. Add bcryptjs to `packages/db/package.json` if not already there.

**Step 2: Verify seed runs**

Run: `pnpm db:seed`
Expected: Seed completes without errors, Account records created

**Step 3: Commit**

```bash
git add packages/db/prisma/seed.ts packages/db/package.json
git commit -m "feat: update seed script to create Account records for BetterAuth"
```

---

### Task 14: Update environment files

**Files:**
- Modify: `.env.example`
- Modify: `.env`

**Step 1: Update .env.example**

Replace `AUTH_SECRET=...` with new variables:

```
BETTER_AUTH_SECRET=replace-with-a-random-secret-at-least-32-chars
BETTER_AUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**Step 2: Update .env**

Same changes — set BETTER_AUTH_SECRET to a random value, leave OAuth client IDs empty for now (OAuth won't work without them but email/password will).

**Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: update .env.example with BetterAuth environment variables"
```

---

### Task 15: Verify build

**Step 1: Generate Prisma client**

Run: `pnpm db:generate`

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No type errors. If there are errors, fix them (likely `displayName` → `name` misses or import path issues).

**Step 3: Build**

Run: `pnpm build`
Expected: Build succeeds

**Step 4: Seed and smoke test**

Run:
```bash
pnpm db:push
pnpm db:seed
pnpm dev
```

Verify: Open http://localhost:3000, sign in with `admin@nojv.local` / `password123`, check session works.

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: resolve build issues from BetterAuth migration"
```
