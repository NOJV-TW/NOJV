import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CompleteProfileForm } from "@/components/complete-profile-form";
import { auth } from "@/lib/auth";
import { hasCompletedHandle, readStringValue } from "@/lib/auth-onboarding";

export default async function CompleteProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const user = session.user as Record<string, unknown>;
  const locale = readStringValue(user.locale) ?? "zh-TW";

  if (hasCompletedHandle(user)) {
    redirect(`/${locale}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg)] px-4">
      <CompleteProfileForm
        email={session.user.email}
        locale={locale}
        name={session.user.name || session.user.email}
      />
    </div>
  );
}
