"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { useLocale, useTranslations } from "next-intl";

import { shellClassNames } from "@nojv/ui";

import { authClient } from "@/lib/auth-client";
import { readPlatformRole } from "@/lib/auth-onboarding";
import { createProblemMutation } from "@/lib/client/course-management-client";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
const textareaClassName = `${inputClassName} min-h-28 resize-y`;

export function ProblemCreationPanel() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const platformRole = readPlatformRole(user);
  const locale = useLocale();
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState("Compiler Intro");
  const [slug, setSlug] = useState("compiler-intro");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("easy");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [summary, setSummary] = useState("Introductory parser warmup.");
  const [statement, setStatement] = useState(
    "Write a recursive descent parser for the input grammar and print whether the stream is valid."
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      await createProblemMutation({
        difficulty,
        slug,
        statement,
        summary,
        title,
        visibility
      });
      setMessage(`Created ${title}. Redirecting to the authored problem...`);
      startTransition(() => {
        router.push(`/${locale}/problems/${slug}`);
      });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Problem creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={`${shellClassNames.card} px-6 py-6`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{tAdmin("authorProblem")}</p>
          <h3 className={shellClassNames.sectionTitle}>{tAdmin("createProblemSubtitle")}</h3>
        </div>
        <span className={shellClassNames.badge}>{platformRole}</span>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <label className="text-sm text-[color:var(--color-muted)]">
          {tAdmin("title")}
          <input
            className={inputClassName}
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("slug")}
            <input
              className={inputClassName}
              onChange={(event) => setSlug(event.target.value)}
              pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
              required
              value={slug}
            />
          </label>
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("difficulty")}
            <select
              className={inputClassName}
              onChange={(event) =>
                setDifficulty(event.target.value as "easy" | "medium" | "hard")
              }
              value={difficulty}
            >
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
          </label>
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("visibility")}
            <select
              className={inputClassName}
              onChange={(event) => setVisibility(event.target.value as "public" | "private")}
              value={visibility}
            >
              <option value="public">public</option>
              <option value="private">private</option>
            </select>
          </label>
        </div>
        <label className="text-sm text-[color:var(--color-muted)]">
          {tAdmin("summary")}
          <textarea
            className={textareaClassName}
            onChange={(event) => setSummary(event.target.value)}
            required
            value={summary}
          />
        </label>
        <label className="text-sm text-[color:var(--color-muted)]">
          {tAdmin("statement")}
          <textarea
            className={`${textareaClassName} min-h-40`}
            onChange={(event) => setStatement(event.target.value)}
            required
            value={statement}
          />
        </label>
        <button
          className="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? tCommon("creating") : tAdmin("createProblem")}
        </button>
        {message ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </form>
    </section>
  );
}
