import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CompleteProfileForm } from "@/components/complete-profile-form";
import { auth } from "@/lib/auth";
import { hasCompletedHandle } from "@/lib/auth-onboarding";

export default async function CompleteProfilePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect(`/${locale}`);
  }

  const user = session.user as Record<string, unknown>;

  if (hasCompletedHandle(user)) {
    redirect(`/${locale}`);
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <CompleteProfileForm
        email={session.user.email}
        locale={locale}
        name={session.user.name || session.user.email}
      />
    </div>
  );
}
