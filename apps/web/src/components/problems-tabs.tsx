"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { formatAcceptanceRate, shellClassNames } from "@nojv/ui";

interface ProblemCard {
  acceptanceRate: number;
  difficulty: "easy" | "hard" | "medium";
  slug: string;
  tags: string[];
  title: string;
  totalSubmissions: number;
}

interface EditableProblemCard {
  difficulty: "easy" | "hard" | "medium";
  slug: string;
  tags: string[];
  title: string;
  visibility: "private" | "public";
}

type Difficulty = "all" | "easy" | "medium" | "hard";

function useFilteredProblems<T extends { difficulty: "easy" | "hard" | "medium"; slug: string; tags: string[]; title: string }>(
  problems: T[]
) {
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("all");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const allTags = useMemo(
    () => [...new Set(problems.flatMap((p) => p.tags))].sort(),
    [problems]
  );

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return problems.filter((p) => {
      if (query && !p.title.toLowerCase().includes(query) && !p.slug.toLowerCase().includes(query)) {
        return false;
      }
      if (difficulty !== "all" && p.difficulty !== difficulty) {
        return false;
      }
      if (selectedTags.size > 0 && ![...selectedTags].every((tag) => p.tags.includes(tag))) {
        return false;
      }
      return true;
    });
  }, [problems, search, difficulty, selectedTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const reset = () => {
    setSearch("");
    setDifficulty("all");
    setSelectedTags(new Set());
  };

  return { allTags, difficulty, filtered, reset, search, selectedTags, setDifficulty, setSearch, toggleTag };
}

export function ProblemsTabs({
  editableProblems,
  publicProblems,
  showCreate
}: {
  editableProblems: EditableProblemCard[] | null;
  publicProblems: ProblemCard[];
  showCreate?: boolean;
}) {
  const [tab, setTab] = useState<"public" | "mine">("public");
  const locale = useLocale();
  const tProblems = useTranslations("problems");
  const tCommon = useTranslations("common");

  const publicFilter = useFilteredProblems(publicProblems);
  const mineFilter = useFilteredProblems(editableProblems ?? []);

  const activeFilter = tab === "public" ? publicFilter : mineFilter;

  const difficulties: Difficulty[] = ["all", "easy", "medium", "hard"];
  const difficultyLabels: Record<Difficulty, string> = {
    all: tProblems("allDifficulties"),
    easy: "Easy",
    hard: "Hard",
    medium: "Medium"
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
            tab === "public"
              ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
              : "border-[color:var(--color-border)] hover:-translate-y-0.5 hover:bg-white/70"
          }`}
          onClick={() => { setTab("public"); mineFilter.reset(); }}
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
            onClick={() => { setTab("mine"); publicFilter.reset(); }}
            type="button"
          >
            {tProblems("myProblems")}
          </button>
        )}
        {showCreate && (
          <Link
            className="ml-auto rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-white/70"
            href={`/${locale}/problems/create`}
          >
            + {tProblems("createNew")}
          </Link>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted)]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx={11} cy={11} r={8} />
            <path d="m21 21-4.35-4.35" strokeLinecap="round" />
          </svg>
          <input
            className="w-full rounded-full border border-[color:var(--color-border)] py-2 pl-9 pr-4 text-sm outline-none focus:border-[color:var(--color-accent)]"
            onChange={(e) => activeFilter.setSearch(e.target.value)}
            placeholder={tProblems("searchProblems")}
            type="text"
            value={activeFilter.search}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2" aria-label={tProblems("filterByDifficulty")} role="group">
          <span className="text-xs font-medium text-[color:var(--color-muted)]">{tCommon("difficulty")}:</span>
          {difficulties.map((d) => (
            <button
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                activeFilter.difficulty === d
                  ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
                  : "border-[color:var(--color-border)] hover:bg-white/70"
              }`}
              key={d}
              onClick={() => activeFilter.setDifficulty(d)}
              type="button"
            >
              {difficultyLabels[d]}
            </button>
          ))}
        </div>

        {activeFilter.allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" aria-label={tProblems("filterByTag")} role="group">
            {activeFilter.allTags.map((tag) => (
              <button
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  activeFilter.selectedTags.has(tag)
                    ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
                    : "border-[color:var(--color-border)] hover:bg-white/70"
                }`}
                key={tag}
                onClick={() => activeFilter.toggleTag(tag)}
                type="button"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "public" && (
        <section className="grid gap-4">
          {publicProblems.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted)]">{tProblems("empty")}</p>
          )}
          {publicProblems.length > 0 && publicFilter.filtered.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted)]">{tProblems("noResults")}</p>
          )}
          {publicFilter.filtered.map((problem) => (
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
                <p className="text-sm text-[color:var(--color-muted)]">
                  {tCommon("difficulty")}
                </p>
                <p className="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-sm text-[color:var(--color-muted)]">
                  {tCommon("acceptance")}
                </p>
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
          {editableProblems.length > 0 && mineFilter.filtered.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted)]">{tProblems("noResults")}</p>
          )}
          {mineFilter.filtered.map((problem) => (
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
                <p className="text-sm text-[color:var(--color-muted)]">
                  {tCommon("difficulty")}
                </p>
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
