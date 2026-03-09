import { getTranslations } from "next-intl/server";
import { shellClassNames } from "@nojv/ui";

import type { CoursePocMember } from "@/lib/server/read-model";

interface CourseMembershipPanelProps {
  members: CoursePocMember[];
}

export async function CourseMembershipPanel({ members }: CourseMembershipPanelProps) {
  const [tCourse, tCommon] = await Promise.all([
    getTranslations("courseDetail"),
    getTranslations("common")
  ]);
  return (
    <section className={`${shellClassNames.card} px-5 py-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{tCourse("roles")}</p>
          <h3 className="mt-1 text-2xl font-semibold">{tCourse("rolesSubtitle")}</h3>
        </div>
        <span className={shellClassNames.badge}>{members.length} {tCommon("members")}</span>
      </div>
      <div className="mt-5 space-y-3">
        {members.map((member) => (
          <article
            className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
            key={member.userId}
          >
            <div>
              <p className="text-lg font-semibold">{member.displayName}</p>
              <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                {member.handle} · {member.email}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                {member.courseRole}
              </p>
              <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                {tCourse("joinedVia")} {member.joinedVia.replaceAll("_", " ")}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
