"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { formatAcceptanceRate, shellClassNames } from "@nojv/ui";

type ProblemCard = {
  acceptanceRate: number;
  difficulty: "easy" | "hard" | "medium";
  slug: string;
  title: string;
  totalSubmissions: number;
};

type EditableProblemCard = {
  difficulty: "easy" | "hard" | "medium";
  slug: string;
  title: string;
  visibility: "private" | "public";
};

export function ProblemsTabs({
  editableProblems,
  publicProblems
}: {
  editableProblems: EditableProblemCard[] | null;
  publicProblems: ProblemCard[];
}) {
  const [tab, setTab] = useState<"public" | "mine">("public");
  const locale = useLocale();
  const tProblems = useTranslations("problems");
  const tCommon = useTranslations("common");

  return (
    <>
      <div className="flex gap-2">
        <button
          className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
            tab === "public"
              ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
              : "border-[color:var(--color-border)] hover:-translate-y-0.5 hover:bg-white/70"
          }`}
          onClick={() => setTab("public")}
          type="button"
        >
          {tProblems("publicLibrary")}
        </button>
        {editableProblems !== null && (
          <button
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              tab === "mine"
                ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
                : "border-[color:var(--color-border)] hover:-translate-y-0.5 hover:bg-white/70"
            }`}
            onClick={() => setTab("mine")}
            type="button"
          >
            {tProblems("myProblems")}
          </button>
        )}
      </div>

      {tab === "public" && (
        <section className="grid gap-4">
          {publicProblems.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted)]">{tProblems("empty")}</p>
          )}
          {publicProblems.map((problem) => (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.8fr_0.8fr] sm:items-center`}
              href={`/${locale}/problems/${problem.slug}`}
              key={problem.slug}
            >
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  {problem.slug}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{problem.title}</h3>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{tCommon("difficulty")}</p>
                <p className="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-sm text-[color:var(--color-muted)]">{tCommon("acceptance")}</p>
                <p className="mt-1 text-lg font-semibold">
                  {formatAcceptanceRate(problem.acceptanceRate)}
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}

      {tab === "mine" && editableProblems !== null && (
        <section className="grid gap-4">
          {editableProblems.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted)]">
              {tProblems("myProblemsEmpty")}
            </p>
          )}
          {editableProblems.map((problem) => (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr] sm:items-center`}
              href={`/${locale}/problems/${problem.slug}`}
              key={problem.slug}
            >
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  {problem.slug}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{problem.title}</h3>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{tCommon("difficulty")}</p>
                <p className="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
              </div>
              <div className="sm:text-right">
                <span
                  className={`${shellClassNames.badge} ${
                    problem.visibility === "public" ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {problem.visibility}
                </span>
              </div>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
