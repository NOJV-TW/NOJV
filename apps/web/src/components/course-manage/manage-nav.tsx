"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import type { EffectiveCourseRole } from "@nojv/domain";

interface ManageNavProps {
  locale: string;
  role: EffectiveCourseRole;
  slug: string;
}

const navItems = [
  { href: "", label: "Overview" },
  { href: "/members", label: "Members" },
  { href: "/problems", label: "Problems" },
  { href: "/assessments", label: "Assessments" }
];

export function ManageNav({ locale, role, slug }: ManageNavProps) {
  const pathname = usePathname();
  const basePath = `/${locale}/courses/${slug}/manage`;

  return (
    <nav className={`${shellClassNames.card} flex items-center gap-1 px-3 py-2`}>
      {navItems.map((item) => {
        const fullHref = `${basePath}${item.href}`;
        const isActive =
          item.href === ""
            ? pathname === basePath
            : pathname.startsWith(fullHref);

        return (
          <Link
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-[color:var(--color-accent)] text-white"
                : "hover:bg-white/60"
            }`}
            href={fullHref}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
      <span className={`ml-auto ${shellClassNames.badge}`}>{role}</span>
    </nav>
  );
}
