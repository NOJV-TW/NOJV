import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

function isPublicPath(pathname: string): boolean {
  // API routes
  if (pathname.startsWith("/api/")) return true;

  // Auth pages: /xx/auth/* or /auth/* (before intl rewrite)
  if (pathname.match(/^(\/[a-zA-Z-]+)?\/auth\//)) return true;

  // Root "/" and locale roots like "/zh-TW", "/en" (no further segments)
  const segments = pathname.split("/").filter(Boolean);
  return segments.length <= 1;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth guard: redirect unauthenticated users to signin
  if (!isPublicPath(pathname)) {
    const hasSession =
      request.cookies.has("better-auth.session_token") ||
      request.cookies.has("__Secure-better-auth.session_token");

    if (!hasSession) {
      // Detect locale from pathname or fall back to default
      const localeMatch = pathname.match(/^\/([a-z-]+)\//);
      const locale = localeMatch?.[1] ?? routing.defaultLocale;
      const homeUrl = new URL(`/${locale}`, request.url);
      return NextResponse.redirect(homeUrl);
    }
  }

  // Run next-intl middleware for locale routing
  const response = intlMiddleware(request);

  // Pass current path to layout for complete-profile redirect
  response.headers.set("x-pathname", pathname);
  return response;
}

export const config = {
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)"
};
