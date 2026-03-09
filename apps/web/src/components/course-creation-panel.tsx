"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { type LocaleCode } from "@nojv/domain";
import { useLocale, useTranslations } from "next-intl";

import { shellClassNames } from "@nojv/ui";

import { createCourseMutation } from "@/lib/client/course-management-client";

import { useActorSession } from "./actor-session-provider";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
const textareaClassName = `${inputClassName} min-h-28 resize-y`;

export function CourseCreationPanel() {
  const locale = useLocale();
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { actor } = useActorSession();
  const [title, setTitle] = useState("Compiler Design");
  const [slug, setSlug] = useState("compiler-design-2026");
  const [description, setDescription] = useState("Course-managed judge surface for compilers.");
  const [courseLocale, setCourseLocale] = useState<LocaleCode>("zh-TW");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      await createCourseMutation(
        {
          description,
          locale: courseLocale,
          slug,
          title
        },
        actor
      );
      setMessage(`Created ${title}. Redirecting to the course surface...`);
      startTransition(() => {
        router.push(`/${locale}/courses/${slug}`);
      });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Course creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={`${shellClassNames.card} px-6 py-6`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{tAdmin("createCourse")}</p>
          <h3 className={shellClassNames.sectionTitle}>{tAdmin("createCourseSubtitle")}</h3>
        </div>
        <span className={shellClassNames.badge}>{actor.platformRole}</span>
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
        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
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
            {tAdmin("locale")}
            <select
              className={inputClassName}
              onChange={(event) => setCourseLocale(event.target.value as LocaleCode)}
              value={courseLocale}
            >
              <option value="zh-TW">zh-TW</option>
              <option value="en">en</option>
            </select>
          </label>
        </div>
        <label className="text-sm text-[color:var(--color-muted)]">
          {tAdmin("description")}
          <textarea
            className={textareaClassName}
            onChange={(event) => setDescription(event.target.value)}
            required
            value={description}
          />
        </label>
        <button
          className="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? tCommon("creating") : tAdmin("createCourseButton")}
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
