import { requireAuth, requireCourseRole } from "@/lib/server/authorization";
import { ManageNav } from "@/components/course-manage/manage-nav";

export const dynamic = "force-dynamic";

export default async function ManageLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const actor = await requireAuth(`/${locale}/auth/signin`);
  const role = await requireCourseRole(actor, slug, "admin", "teacher", "ta");

  return (
    <div className="space-y-6">
      <ManageNav locale={locale} role={role} slug={slug} />
      {children}
    </div>
  );
}
