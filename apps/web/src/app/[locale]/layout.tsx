import Link from "next/link";
import { notFound } from "next/navigation";

import { getCopy, isLocale, locales, type LocaleCode } from "@nojv/i18n";

import { ActorSessionControl, ActorSessionProvider } from "@/components/actor-session-provider";
import { UserAuthMenu } from "@/components/user-auth-menu";

const navigation = (locale: LocaleCode) => {
  const labels = getCopy(locale).navigation;

  return [
    { href: `/${locale}`, label: labels.dashboard },
    { href: `/${locale}/problems`, label: labels.problems },
    { href: `/${locale}/contests`, label: labels.contests },
    { href: `/${locale}/courses`, label: labels.courses },
    { href: `/${locale}/submissions`, label: labels.submissions },
    { href: `/${locale}/integrity`, label: labels.integrity }
  ];
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return (
    <ActorSessionProvider>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-5 py-3 backdrop-blur-sm sm:px-6">
          <div className="flex flex-wrap items-center gap-4">
            <Link className="font-[family-name:var(--font-display)] text-xl font-bold" href={`/${locale}`}>
              NOJV
            </Link>
            <nav className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {navigation(locale).map((item) => (
                <Link
                  className="rounded-full border border-[color:var(--color-border)] px-4 py-2 transition hover:-translate-y-0.5 hover:bg-white/70"
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-white/60 p-1 text-sm">
                {locales.map((entry) => (
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
              {process.env.NODE_ENV === "development" && <ActorSessionControl />}
            </div>
          </div>
        </header>
        <main className="flex-1 pt-6">{children}</main>
      </div>
    </ActorSessionProvider>
  );
}
