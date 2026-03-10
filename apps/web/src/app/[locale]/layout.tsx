import { hasLocale } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { routing } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { hasCompletedHandle } from "@/lib/auth-onboarding";
import { UserAuthMenu } from "@/components/user-auth-menu";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() });

  const hdrs = await headers();
  const currentPath = hdrs.get("x-pathname") ?? `/${locale}`;
  const isAuthRoute = currentPath.includes("/auth/");

  if (
    session?.user &&
    !hasCompletedHandle(session.user as Record<string, unknown>) &&
    !isAuthRoute
  ) {
    redirect(`/${locale}/auth/complete-profile`);
  }

  const [messages, tNav] = await Promise.all([getMessages(), getTranslations("navigation")]);

  const isLoggedIn = !!session?.user;

  const navItems = isLoggedIn
    ? [
        { href: `/${locale}/problems`, label: tNav("problems") },
        { href: `/${locale}/courses`, label: tNav("courses") },
        { href: `/${locale}/assignments`, label: tNav("assignments") },
        { href: `/${locale}/exams`, label: tNav("exams") }
      ]
    : [];

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-5 py-3 backdrop-blur-sm sm:px-6">
          <div className="flex flex-wrap items-center gap-4">
            <Link
              className="font-[family-name:var(--font-display)] text-xl font-bold"
              href={`/${locale}`}
            >
              NOJV
            </Link>
            {navItems.length > 0 && (
              <nav className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {navItems.map((item) => (
                  <Link
                    className="rounded-full border border-[color:var(--color-border)] px-4 py-2 transition hover:-translate-y-0.5 hover:bg-white/70"
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-white/60 p-1 text-sm">
                {routing.locales.map((entry) => (
                  <Link
                    className={`rounded-full px-3 py-1.5 ${entry === locale ? "bg-[color:var(--color-accent)] text-white" : ""}`}
                    href={`/${entry}`}
                    key={entry}
                  >
                    {entry}
                  </Link>
                ))}
              </div>
              <UserAuthMenu />
            </div>
          </div>
        </header>
        <main className="flex-1 pt-6">{children}</main>
      </div>
    </NextIntlClientProvider>
  );
}
