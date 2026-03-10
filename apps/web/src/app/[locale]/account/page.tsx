import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import { readHandleFromAuthUser, readStringValue } from "@/lib/auth-onboarding";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect(`/${locale}`);
  }

  const [tNav, tAccount] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("account")
  ]);
  const user = session.user as Record<string, unknown>;
  const handle = readHandleFromAuthUser(user) ?? "—";
  const platformRole = readStringValue(user.platformRole) ?? "student";

  return (
    <div className="space-y-6">
      <h2 className="font-[family-name:var(--font-display)] text-3xl">{tNav("account")}</h2>
      <section className={`${shellClassNames.card} px-6 py-6`}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-[color:var(--color-muted)]">{tAccount("name")}</dt>
            <dd className="mt-1 font-medium">{session.user.name}</dd>
          </div>
          <div>
            <dt className="text-sm text-[color:var(--color-muted)]">{tAccount("email")}</dt>
            <dd className="mt-1 font-medium">{session.user.email}</dd>
          </div>
          <div>
            <dt className="text-sm text-[color:var(--color-muted)]">{tAccount("userAccount")}</dt>
            <dd className="mt-1 font-medium">{handle}</dd>
          </div>
          <div>
            <dt className="text-sm text-[color:var(--color-muted)]">{tAccount("role")}</dt>
            <dd className="mt-1 font-medium">{platformRole}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
