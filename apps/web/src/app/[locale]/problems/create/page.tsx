import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ProblemCreationPanel } from "@/components/problem-creation-panel";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CreateProblemPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect(`/${locale}/problems`);
  }

  const tProblems = await getTranslations("problems");

  return (
    <div className="space-y-6">
      <h2 className="font-[family-name:var(--font-display)] text-3xl">
        {tProblems("createNew")}
      </h2>
      <ProblemCreationPanel />
    </div>
  );
}
