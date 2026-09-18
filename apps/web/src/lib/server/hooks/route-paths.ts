const PROFILE_EXEMPT_PREFIXES = [
  "/api/",
  "/complete-profile",
  "/verify-school",
  "/signin",
  "/admin-signin",
  "/signup",
];

const LOCALE_PREFIXES = ["/zh-TW"];

export function stripLocalePrefix(pathname: string): string {
  for (const lp of LOCALE_PREFIXES) {
    if (pathname === lp || pathname.startsWith(lp + "/")) {
      return pathname.slice(lp.length) || "/";
    }
  }
  return pathname;
}

export function isProfileExempt(pathname: string): boolean {
  const clean = stripLocalePrefix(pathname);
  return PROFILE_EXEMPT_PREFIXES.some((p) => clean.startsWith(p));
}

export function isPageLockExempt(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/signin") ||
    pathname.startsWith("/signup")
  );
}
