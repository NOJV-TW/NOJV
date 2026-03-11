# School Verification & Auth Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace credentials-based auth with OAuth-only login, add three-school alliance email verification flow, and general handle onboarding — all with proper validation rules.

**Architecture:** OAuth (GitHub/Google) is the primary login. After first login, users choose between school email verification (handle auto-set to student ID) or free-form handle. School verification uses Resend for email delivery and BroadcastChannel for cross-tab notification. An admin-signin page preserves handle+password login for testing.

**Tech Stack:** better-auth, Resend, BroadcastChannel API, Next.js App Router, Prisma, Zod, next-intl

---

## Task 1: Install Resend & add env vars

**Files:**
- Modify: `apps/web/package.json`

**Step 1: Install resend**

Run: `cd /Users/takala/code/NOJV && pnpm add resend --filter @nojv/web`

**Step 2: Add env var to .env.example (if exists) or note in plan**

The app needs `RESEND_API_KEY` and `APP_URL` (e.g. `http://localhost:3000`) in environment. No code change needed — just ensure these are set at runtime.

**Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add resend package for school email verification"
```

---

## Task 2: Add school email validation utilities

**Files:**
- Create: `apps/web/src/lib/school-verification.ts`
- Create: `apps/web/tests/school-verification.test.ts`

**Step 1: Write the tests**

```typescript
// apps/web/tests/school-verification.test.ts
import { describe, expect, it } from "vitest";

import {
  extractStudentId,
  isReservedHandle,
  isStudentIdFormat,
  parseSchoolEmail
} from "../src/lib/school-verification";

describe("parseSchoolEmail", () => {
  // NTNU: 8 digits + 1 letter
  it("parses NTNU primary email", () => {
    const r = parseSchoolEmail("41071234A@ntnu.edu.tw");
    expect(r).toEqual({ school: "ntnu", studentId: "41071234a" });
  });

  it("parses NTNU gapps email", () => {
    const r = parseSchoolEmail("41071234a@gapps.ntnu.edu.tw");
    expect(r).toEqual({ school: "ntnu", studentId: "41071234a" });
  });

  // NTU: 1 letter + 8 digits
  it("parses NTU primary email", () => {
    const r = parseSchoolEmail("B12345678@ntu.edu.tw");
    expect(r).toEqual({ school: "ntu", studentId: "b12345678" });
  });

  it("parses NTU g.ntu email", () => {
    const r = parseSchoolEmail("b12345678@g.ntu.edu.tw");
    expect(r).toEqual({ school: "ntu", studentId: "b12345678" });
  });

  // NTUST: 1 letter + 8 digits
  it("parses NTUST mail email", () => {
    const r = parseSchoolEmail("B12345678@mail.ntust.edu.tw");
    expect(r).toEqual({ school: "ntust", studentId: "b12345678" });
  });

  it("parses NTUST gapps email", () => {
    const r = parseSchoolEmail("b12345678@gapps.ntust.edu.tw");
    expect(r).toEqual({ school: "ntust", studentId: "b12345678" });
  });

  it("returns null for non-school email", () => {
    expect(parseSchoolEmail("user@gmail.com")).toBeNull();
  });

  it("returns null for invalid student ID format", () => {
    expect(parseSchoolEmail("notavalid@ntnu.edu.tw")).toBeNull();
  });
});

describe("extractStudentId → handle", () => {
  it("NTNU student ID becomes handle without prefix", () => {
    expect(extractStudentId("ntnu", "41071234a")).toBe("41071234a");
  });

  it("NTU student ID gets ntu_ prefix", () => {
    expect(extractStudentId("ntu", "b12345678")).toBe("ntu_b12345678");
  });

  it("NTUST student ID gets ntust_ prefix", () => {
    expect(extractStudentId("ntust", "b12345678")).toBe("ntust_b12345678");
  });
});

describe("isStudentIdFormat", () => {
  it("matches NTNU format (8 digits + 1 letter)", () => {
    expect(isStudentIdFormat("41071234a")).toBe(true);
  });

  it("matches NTU/NTUST format (1 letter + 8 digits)", () => {
    expect(isStudentIdFormat("b12345678")).toBe(true);
  });

  it("rejects random string", () => {
    expect(isStudentIdFormat("john-doe")).toBe(false);
  });
});

describe("isReservedHandle", () => {
  it("rejects raw student ID format", () => {
    expect(isReservedHandle("41071234a")).toBe(true);
    expect(isReservedHandle("b12345678")).toBe(true);
  });

  it("rejects ntu_ prefixed handle", () => {
    expect(isReservedHandle("ntu_b12345678")).toBe(true);
  });

  it("rejects ntust_ prefixed handle", () => {
    expect(isReservedHandle("ntust_b12345678")).toBe(true);
  });

  it("rejects ntnu_ prefixed handle", () => {
    expect(isReservedHandle("ntnu_41071234a")).toBe(true);
  });

  it("allows normal handle", () => {
    expect(isReservedHandle("john-doe")).toBe(false);
  });

  it("allows handle starting with ntu but not matching pattern", () => {
    expect(isReservedHandle("ntu_lover")).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web test -- school-verification`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// apps/web/src/lib/school-verification.ts

export type School = "ntnu" | "ntu" | "ntust";

export interface SchoolEmailResult {
  school: School;
  studentId: string;
}

// NTNU: 8 digits + 1 letter
const NTNU_ID_RE = /^\d{8}[a-z]$/;
// NTU/NTUST: 1 letter + 8 digits
const NTU_NTUST_ID_RE = /^[a-z]\d{8}$/;

const SCHOOL_DOMAINS: Record<string, School> = {
  "ntnu.edu.tw": "ntnu",
  "gapps.ntnu.edu.tw": "ntnu",
  "ntu.edu.tw": "ntu",
  "g.ntu.edu.tw": "ntu",
  "mail.ntust.edu.tw": "ntust",
  "gapps.ntust.edu.tw": "ntust"
};

function isValidStudentIdForSchool(id: string, school: School): boolean {
  if (school === "ntnu") return NTNU_ID_RE.test(id);
  return NTU_NTUST_ID_RE.test(id);
}

export function parseSchoolEmail(email: string): SchoolEmailResult | null {
  const atIndex = email.indexOf("@");
  if (atIndex < 0) return null;

  const localPart = email.slice(0, atIndex).toLowerCase();
  const domain = email.slice(atIndex + 1).toLowerCase();

  const school = SCHOOL_DOMAINS[domain];
  if (!school) return null;

  if (!isValidStudentIdForSchool(localPart, school)) return null;

  return { school, studentId: localPart };
}

export function extractStudentId(school: School, studentId: string): string {
  if (school === "ntnu") return studentId;
  return `${school}_${studentId}`;
}

/** Returns true if the value looks like a student ID (any school) */
export function isStudentIdFormat(value: string): boolean {
  return NTNU_ID_RE.test(value) || NTU_NTUST_ID_RE.test(value);
}

/** Returns true if the handle is reserved for school verification */
export function isReservedHandle(handle: string): boolean {
  // Direct student ID format
  if (isStudentIdFormat(handle)) return true;

  // Prefixed format: ntu_<id>, ntust_<id>, ntnu_<id>
  for (const prefix of ["ntu_", "ntust_", "ntnu_"]) {
    if (handle.startsWith(prefix)) {
      const rest = handle.slice(prefix.length);
      if (isStudentIdFormat(rest)) return true;
    }
  }

  return false;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web test -- school-verification`
Expected: All PASS

**Step 5: Commit**

```bash
git add apps/web/src/lib/school-verification.ts apps/web/tests/school-verification.test.ts
git commit -m "feat: add school email parsing and handle reservation utilities"
```

---

## Task 3: Create school verification API route (send email)

**Files:**
- Create: `apps/web/src/app/api/auth/send-school-verification/route.ts`

**Step 1: Write the API route**

```typescript
// apps/web/src/app/api/auth/send-school-verification/route.ts
import { randomBytes } from "crypto";

import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";

import { prisma } from "@nojv/db";

import { auth } from "@/lib/auth";
import { extractStudentId, parseSchoolEmail } from "@/lib/school-verification";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { email?: string };
  const email = typeof body.email === "string" ? body.email.trim() : "";

  const parsed = parseSchoolEmail(email);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid school email" }, { status: 400 });
  }

  const handle = extractStudentId(parsed.school, parsed.studentId);

  // Check if handle is already taken by another user
  const existing = await prisma.user.findUnique({ where: { handle } });
  if (existing && existing.id !== session.user.id) {
    return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
  }

  // Generate verification token (stored in Verification table)
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await prisma.verification.create({
    data: {
      id: token,
      identifier: session.user.id,
      value: JSON.stringify({ email, handle, school: parsed.school, studentId: parsed.studentId }),
      expiresAt
    }
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const verifyUrl = `${appUrl}/api/auth/verify-school?token=${token}`;

  await resend.emails.send({
    from: "NOJV <noreply@nojv.org>",
    to: email,
    subject: "NOJV 三校聯盟帳號驗證",
    html: `
      <h2>NOJV 帳號驗證</h2>
      <p>請點擊以下連結完成三校聯盟帳號驗證：</p>
      <p><a href="${verifyUrl}">驗證我的帳號</a></p>
      <p>此連結將在 30 分鐘後失效。</p>
      <p>如果您沒有申請此驗證，請忽略這封信。</p>
    `
  });

  return NextResponse.json({ ok: true });
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/api/auth/send-school-verification/route.ts
git commit -m "feat: add send-school-verification API route with Resend"
```

---

## Task 4: Create school verification API route (verify token)

**Files:**
- Create: `apps/web/src/app/api/auth/verify-school/route.ts`

**Step 1: Write the verification endpoint**

This endpoint verifies the token, updates the user's handle in DB, and returns an HTML page that sends a BroadcastChannel message and shows a success message.

```typescript
// apps/web/src/app/api/auth/verify-school/route.ts
import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@nojv/db";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return new NextResponse(renderHtml("error", "缺少驗證 token"), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  const record = await prisma.verification.findUnique({ where: { id: token } });

  if (!record || record.expiresAt < new Date()) {
    // Clean up expired token
    if (record) {
      await prisma.verification.delete({ where: { id: token } });
    }
    return new NextResponse(renderHtml("error", "驗證連結已過期或無效"), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  const data = JSON.parse(record.value) as { handle: string };

  // Check handle not taken by someone else
  const existing = await prisma.user.findUnique({ where: { handle: data.handle } });
  if (existing && existing.id !== record.identifier) {
    await prisma.verification.delete({ where: { id: token } });
    return new NextResponse(renderHtml("error", "此學號已被其他帳號使用"), {
      status: 409,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // Update user handle
  await prisma.user.update({
    where: { id: record.identifier },
    data: { handle: data.handle, displayHandle: data.handle }
  });

  // Delete used token
  await prisma.verification.delete({ where: { id: token } });

  return new NextResponse(renderHtml("success", data.handle), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function renderHtml(status: "success" | "error", detail: string): string {
  const isSuccess = status === "success";
  const title = isSuccess ? "驗證成功" : "驗證失敗";
  const message = isSuccess
    ? `你的 NOJV 帳號已設定為 <strong>${detail}</strong>。你可以關閉此頁面。`
    : detail;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — NOJV</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8f8f8; }
    .card { background: white; border-radius: 1rem; padding: 2rem; max-width: 24rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .success { color: #16a34a; }
    .error { color: #dc2626; }
  </style>
</head>
<body>
  <div class="card">
    <h1 class="${status}">${title}</h1>
    <p>${message}</p>
  </div>
  ${isSuccess ? `<script>
    try {
      const bc = new BroadcastChannel("nojv-school-verify");
      bc.postMessage({ type: "verified", handle: ${JSON.stringify(detail)} });
      bc.close();
    } catch (_) {}
  </script>` : ""}
</body>
</html>`;
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/api/auth/verify-school/route.ts
git commit -m "feat: add verify-school endpoint with handle update and BroadcastChannel"
```

---

## Task 5: Disable emailAndPassword in auth config

**Files:**
- Modify: `apps/web/src/lib/auth.ts`
- Modify: `apps/web/tests/auth-config.test.ts`

**Step 1: Update auth.ts — remove emailAndPassword**

In `apps/web/src/lib/auth.ts`, remove:
```typescript
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true
  },
```

The resulting auth config should keep socialProviders, user, account, and plugins as-is but drop emailAndPassword entirely.

**Step 2: Update auth-config.test.ts**

Remove any assertion that expects emailAndPassword to be in the config. The test should still verify plugins and username config are correct.

**Step 3: Run tests**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web test -- auth-config`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/lib/auth.ts apps/web/tests/auth-config.test.ts
git commit -m "feat: disable emailAndPassword auth, OAuth-only login"
```

---

## Task 6: Rewrite signin page (OAuth only + admin link)

**Files:**
- Modify: `apps/web/src/app/[locale]/auth/signin/page.tsx`
- Modify: `apps/web/messages/en.json` (auth section)
- Modify: `apps/web/messages/zh-TW.json` (auth section)

**Step 1: Rewrite signin page**

```tsx
// apps/web/src/app/[locale]/auth/signin/page.tsx
"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const locale = useLocale();
  const t = useTranslations("auth");

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: `/${locale}`, provider });
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-6 text-center text-2xl font-semibold">{t("signInTitle")}</h1>

        <div className="flex flex-col gap-3">
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2.5 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("github")}
            type="button"
          >
            GitHub
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2.5 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("google")}
            type="button"
          >
            Google
          </button>
        </div>

        <div className="mt-6 text-center">
          <Link
            className="text-xs text-[color:var(--color-muted)] underline transition hover:text-[color:var(--color-ink)]"
            href={`/${locale}/auth/admin-signin`}
          >
            {t("adminSignIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update i18n messages**

In `en.json` auth section, replace with:
```json
{
  "adminSignIn": "Admin login",
  "signIn": "Sign in",
  "signInTitle": "Sign in to NOJV",
  "signOut": "Sign out"
}
```

In `zh-TW.json` auth section, replace with:
```json
{
  "adminSignIn": "管理員登入",
  "signIn": "登入",
  "signInTitle": "登入 NOJV",
  "signOut": "登出"
}
```

**Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/auth/signin/page.tsx apps/web/messages/en.json apps/web/messages/zh-TW.json
git commit -m "feat: rewrite signin page — OAuth-only with admin login link"
```

---

## Task 7: Create admin-signin page

**Files:**
- Create: `apps/web/src/app/[locale]/auth/admin-signin/page.tsx`

**Step 1: Write the admin signin page**

This page is a simple handle + password form. It uses better-auth's `signIn.username` method.

```tsx
// apps/web/src/app/[locale]/auth/admin-signin/page.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { authClient } from "@/lib/auth-client";

export default function AdminSignInPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("auth");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const identity = (form.get("identity") as string).trim();
    const password = form.get("password") as string;

    const isEmail = identity.includes("@");
    const { error: signInError } = isEmail
      ? await authClient.signIn.email({ email: identity, password })
      : await authClient.signIn.username({ username: identity, password });

    setLoading(false);

    if (signInError) {
      setError(signInError.message ?? "Invalid credentials");
      return;
    }

    router.push(`/${locale}`);
    router.refresh();
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-2 text-center text-2xl font-semibold">{t("adminSignIn")}</h1>
        <p className="mb-6 text-center text-xs text-[color:var(--color-muted)]">
          Handle + password login for testing
        </p>

        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="flex flex-col gap-1 text-sm">
            Handle or Email
            <input
              autoComplete="username"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="identity"
              required
              type="text"
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
        <div className="mt-4 text-center">
          <Link
            className="text-xs text-[color:var(--color-muted)] underline"
            href={`/${locale}/auth/signin`}
          >
            {t("signIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/[locale]/auth/admin-signin/page.tsx
git commit -m "feat: add admin-signin page for handle+password testing login"
```

---

## Task 8: Rewrite complete-profile page (two-option flow)

**Files:**
- Modify: `apps/web/src/app/[locale]/auth/complete-profile/page.tsx`
- Modify: `apps/web/src/components/complete-profile-form.tsx`
- Modify: `apps/web/src/lib/auth-onboarding.ts`
- Modify: `apps/web/messages/en.json` (add `onboarding` section)
- Modify: `apps/web/messages/zh-TW.json` (add `onboarding` section)

**Step 1: Add i18n keys**

Add `"onboarding"` section to both `en.json` and `zh-TW.json`:

en.json:
```json
"onboarding": {
  "title": "Set up your NOJV account",
  "subtitle": "Choose how to set your handle",
  "schoolOption": "Three-School Alliance",
  "schoolOptionDesc": "Verify with your NTNU / NTU / NTUST email",
  "generalOption": "General Account",
  "generalOptionDesc": "Choose your own handle",
  "schoolEmailLabel": "School email",
  "schoolEmailPlaceholder": "e.g. b12345678@ntu.edu.tw",
  "sendVerification": "Send verification email",
  "sending": "Sending...",
  "verificationSent": "Verification email sent! Check your inbox and click the link.",
  "waitingVerification": "Waiting for verification...",
  "handleLabel": "NOJV handle",
  "handlePlaceholder": "e.g. john-doe",
  "handleReserved": "This handle format is reserved for school accounts.",
  "continue": "Continue",
  "saving": "Saving...",
  "back": "Back",
  "useOtherAccount": "Use a different account",
  "verified": "Verified! Redirecting..."
}
```

zh-TW.json:
```json
"onboarding": {
  "title": "設定你的 NOJV 帳號",
  "subtitle": "選擇設定代稱的方式",
  "schoolOption": "三校聯盟帳號",
  "schoolOptionDesc": "使用師大 / 台大 / 台科大 email 驗證",
  "generalOption": "一般帳號",
  "generalOptionDesc": "自行選擇代稱",
  "schoolEmailLabel": "學校信箱",
  "schoolEmailPlaceholder": "例如 b12345678@ntu.edu.tw",
  "sendVerification": "發送驗證信",
  "sending": "發送中...",
  "verificationSent": "驗證信已寄出！請檢查你的信箱並點擊連結。",
  "waitingVerification": "等待驗證中...",
  "handleLabel": "NOJV 代稱",
  "handlePlaceholder": "例如 john-doe",
  "handleReserved": "此代稱格式保留給學校帳號使用。",
  "continue": "繼續",
  "saving": "儲存中...",
  "back": "返回",
  "useOtherAccount": "使用其他帳號",
  "verified": "驗證成功！跳轉中..."
}
```

**Step 2: Update auth-onboarding.ts — add isReservedHandle re-export**

Add to `apps/web/src/lib/auth-onboarding.ts`:

```typescript
export { isReservedHandle } from "@/lib/school-verification";
```

**Step 3: Rewrite complete-profile-form.tsx**

Replace the entire `apps/web/src/components/complete-profile-form.tsx` with a two-tab form: school verification flow and general handle flow.

```tsx
// apps/web/src/components/complete-profile-form.tsx
"use client";

import { type SyntheticEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { HANDLE_INPUT_PATTERN, isValidHandle } from "@/lib/auth-onboarding";
import { isReservedHandle, parseSchoolEmail } from "@/lib/school-verification";
import { authClient } from "@/lib/auth-client";

interface CompleteProfileFormProps {
  email: string;
  locale: string;
  name: string;
}

type Mode = "choose" | "school" | "general";

export function CompleteProfileForm({ email, locale, name }: CompleteProfileFormProps) {
  const router = useRouter();
  const t = useTranslations("onboarding");
  const [mode, setMode] = useState<Mode>("choose");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // --- School flow state ---
  const [schoolEmail, setSchoolEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [verified, setVerified] = useState(false);

  // --- General flow state ---
  const [handle, setHandle] = useState("");

  // Listen for BroadcastChannel verification
  useEffect(() => {
    if (mode !== "school" || !emailSent) return;

    const bc = new BroadcastChannel("nojv-school-verify");
    bc.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === "verified") {
        setVerified(true);
        // Small delay to show success, then redirect
        setTimeout(() => {
          router.push(`/${locale}`);
          router.refresh();
        }, 1500);
      }
    };
    return () => bc.close();
  }, [mode, emailSent, locale, router]);

  async function handleSendVerification(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmed = schoolEmail.trim();
    if (!parseSchoolEmail(trimmed)) {
      setError("請輸入有效的三校 email（ntnu / ntu / ntust）");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth/send-school-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed })
    });

    setLoading(false);

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Failed to send verification email");
      return;
    }

    setEmailSent(true);
  }

  async function handleGeneralSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const normalized = handle.trim().toLowerCase();

    if (!isValidHandle(normalized)) {
      setError("Use 3-64 lowercase letters, digits, dots, hyphens, or underscores.");
      return;
    }

    if (isReservedHandle(normalized)) {
      setError(t("handleReserved"));
      return;
    }

    setLoading(true);

    const { error: updateError } = await authClient.updateUser({
      username: normalized
    });

    setLoading(false);

    if (updateError) {
      setError(updateError.message ?? "Failed to save handle.");
      return;
    }

    router.push(`/${locale}`);
    router.refresh();
  }

  async function handleSignOut() {
    await authClient.signOut();
    router.push(`/${locale}`);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8 shadow-sm">
      <h1 className="text-center text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-center text-sm text-[color:var(--color-muted)]">
        {name} ({email})
      </p>

      {mode === "choose" && (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-center text-sm text-[color:var(--color-muted)]">{t("subtitle")}</p>
          <button
            className="rounded-lg border border-[color:var(--color-border)] px-4 py-3 text-left transition hover:bg-white/70"
            onClick={() => setMode("school")}
            type="button"
          >
            <p className="text-sm font-medium">{t("schoolOption")}</p>
            <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
              {t("schoolOptionDesc")}
            </p>
          </button>
          <button
            className="rounded-lg border border-[color:var(--color-border)] px-4 py-3 text-left transition hover:bg-white/70"
            onClick={() => setMode("general")}
            type="button"
          >
            <p className="text-sm font-medium">{t("generalOption")}</p>
            <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
              {t("generalOptionDesc")}
            </p>
          </button>
          <button
            className="mt-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleSignOut()}
            type="button"
          >
            {t("useOtherAccount")}
          </button>
        </div>
      )}

      {mode === "school" && (
        <div className="mt-6">
          {verified ? (
            <p className="text-center text-sm font-medium text-green-600">{t("verified")}</p>
          ) : emailSent ? (
            <div className="flex flex-col items-center gap-3">
              <div className="size-6 animate-spin rounded-full border-2 border-[color:var(--color-accent)] border-t-transparent" />
              <p className="text-center text-sm text-[color:var(--color-muted)]">
                {t("verificationSent")}
              </p>
              <p className="text-center text-xs text-[color:var(--color-muted)]">
                {t("waitingVerification")}
              </p>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => void handleSendVerification(e)}
            >
              <label className="flex flex-col gap-1 text-sm">
                {t("schoolEmailLabel")}
                <input
                  className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
                  onChange={(e) => setSchoolEmail(e.target.value)}
                  placeholder={t("schoolEmailPlaceholder")}
                  required
                  type="email"
                  value={schoolEmail}
                />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                className="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={loading}
                type="submit"
              >
                {loading ? t("sending") : t("sendVerification")}
              </button>
              <button
                className="rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
                onClick={() => {
                  setMode("choose");
                  setError("");
                }}
                type="button"
              >
                {t("back")}
              </button>
            </form>
          )}
        </div>
      )}

      {mode === "general" && (
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => void handleGeneralSubmit(e)}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("handleLabel")}
            <input
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              maxLength={64}
              onChange={(e) => setHandle(e.target.value)}
              pattern={HANDLE_INPUT_PATTERN}
              placeholder={t("handlePlaceholder")}
              required
              title="3-64 characters, lowercase letters, digits, dots, hyphens, underscores"
              type="text"
              value={handle}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            className="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? t("saving") : t("continue")}
          </button>
          <button
            className="rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => {
              setMode("choose");
              setError("");
            }}
            type="button"
          >
            {t("back")}
          </button>
        </form>
      )}
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add apps/web/src/components/complete-profile-form.tsx apps/web/src/lib/auth-onboarding.ts apps/web/messages/en.json apps/web/messages/zh-TW.json
git commit -m "feat: rewrite complete-profile to two-option flow (school / general)"
```

---

## Task 9: Delete signup page & update homepage

**Files:**
- Delete: `apps/web/src/app/[locale]/auth/signup/page.tsx`
- Modify: `apps/web/src/app/[locale]/page.tsx`

**Step 1: Delete signup page**

Run: `rm apps/web/src/app/[locale]/auth/signup/page.tsx`

**Step 2: Update homepage — remove Sign Up button**

In `apps/web/src/app/[locale]/page.tsx`, replace the two-button div (lines 90-103) with a single Sign In button:

```tsx
          <div className="mt-2 flex gap-3">
            <Link
              className="rounded-full bg-[color:var(--color-accent)] px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
              href={`/${locale}/auth/signin`}
            >
              {tAuth("signIn")}
            </Link>
          </div>
```

**Step 3: Remove unused i18n keys**

In both `en.json` and `zh-TW.json`, remove from `auth` section:
- `emailOrHandle`
- `invalidCredentials`
- `noAccount`
- `or`
- `password`
- `signingIn`
- `signUp`

**Step 4: Commit**

```bash
git rm apps/web/src/app/[locale]/auth/signup/page.tsx
git add apps/web/src/app/[locale]/page.tsx apps/web/messages/en.json apps/web/messages/zh-TW.json
git commit -m "feat: remove signup page, simplify homepage to single sign-in button"
```

---

## Task 10: Update seed to keep admin-signin working

**Files:**
- Modify: `packages/db/prisma/seed.ts`

The seed already creates credential accounts with `providerId: "credential"` and bcrypt password hashes. This is exactly what better-auth's `emailAndPassword` plugin uses. However, since we're disabling `emailAndPassword` in the auth config, we need to re-enable it specifically for the admin-signin flow.

**Step 1: Re-enable emailAndPassword in auth.ts but only for sign-in (no sign-up)**

Actually, looking at this more carefully: better-auth's `signIn.username` and `signIn.email` require `emailAndPassword.enabled: true`. For the admin-signin page to work, we need to keep emailAndPassword enabled but just not expose it on the main signin page.

In `apps/web/src/lib/auth.ts`, re-add:
```typescript
  emailAndPassword: {
    enabled: true
  },
```

(Remove `requireEmailVerification: true` since OAuth users don't need it.)

This means Task 5 should NOT remove emailAndPassword — instead just remove `requireEmailVerification`. The admin-signin page relies on the credential provider being available.

**Step 2: No seed changes needed**

The seed already works correctly.

**Step 3: Commit**

```bash
git add apps/web/src/lib/auth.ts
git commit -m "fix: keep emailAndPassword enabled for admin-signin, remove requireEmailVerification"
```

---

## Task 11: Cleanup & verify

**Step 1: Run typecheck**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web typecheck`
Expected: No errors

**Step 2: Run tests**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web test`
Expected: All pass

**Step 3: Run lint**

Run: `cd /Users/takala/code/NOJV && pnpm --filter @nojv/web lint`
Expected: No errors

**Step 4: Manual test checklist**

1. Visit `/auth/signin` → should see GitHub + Google buttons + small "管理員登入" link
2. Visit `/auth/signup` → should 404
3. Click admin login → should show handle+password form
4. Log in via OAuth → if no handle, should redirect to complete-profile
5. Complete-profile → should show two options (school / general)
6. School flow → enter school email → receive verification email → click link → handle auto-set → original page redirects
7. General flow → enter handle → blocked if student ID format → otherwise set handle

**Step 5: Final commit if any fixes needed**

---

## Important Note on Task 5 vs Task 10

Task 5 originally says to remove `emailAndPassword`. However, Task 10 clarifies that we need to **keep** `emailAndPassword.enabled: true` for the admin-signin page to work. The correct approach:

- **In Task 5:** Change `emailAndPassword` to `{ enabled: true }` (remove `requireEmailVerification: true`), rather than removing it entirely.
- **Task 10** then becomes a no-op for the auth config.

This is the simpler path: the credentials provider stays enabled server-side, but the main signin page only shows OAuth buttons. The admin-signin page is the only UI that uses credentials.
