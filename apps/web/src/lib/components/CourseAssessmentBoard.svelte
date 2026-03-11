<script lang="ts">
  import { t } from "svelte-i18n";
  import type { CourseAssessmentRecord } from "$lib/server/read-model";
  import {
    deriveAssessmentPresentation,
    deriveAssessmentWindowState
  } from "$lib/course-assessment-helpers";

  interface Props {
    assessments: CourseAssessmentRecord[];
    courseSlug: string;
    locale: string;
  }

  let { assessments, courseSlug, locale }: Props = $props();
</script>

<section
  class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
        {$t("courseDetail.assessmentBoard")}
      </p>
      <h3 class="mt-1 text-2xl font-semibold">
        {$t("courseDetail.assessmentBoardSubtitle")}
      </h3>
    </div>
    <span
      class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
    >
      {assessments.length} {$t("common.assessments")}
    </span>
  </div>
  <div class="mt-5 grid gap-4">
    {#each assessments as assessment (assessment.slug)}
      {@const presentation = deriveAssessmentPresentation({
        scoreboardMode: assessment.scoreboardMode,
        type: assessment.type
      })}
      {@const windowState = deriveAssessmentWindowState({
        closesAt: assessment.closesAt,
        dueAt: assessment.dueAt,
        opensAt: assessment.opensAt
      })}
      {@const href =
        assessment.type === "exam"
          ? `/${locale}/courses/${courseSlug}/exams/${assessment.slug}`
          : `/${locale}/courses/${courseSlug}/assignments/${assessment.slug}`}
      <a
        class="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 transition hover:-translate-y-0.5"
        {href}
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p
              class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]"
            >
              {assessment.type}
            </p>
            <p class="mt-2 text-lg font-semibold">{assessment.title}</p>
            <p class="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
              {assessment.summary}
            </p>
          </div>
          <div class="text-right">
            <span
              class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
            >
              {windowState}
            </span>
            <p class="mt-2 text-sm text-[color:var(--color-muted)]">
              {assessment.problemSlugs.length} {$t("contestDetail.problems")}
            </p>
          </div>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">
              {$t("courseDetail.framing")}
            </p>
            <p class="mt-1 font-semibold">{presentation.heroLabel}</p>
          </div>
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">
              {$t("courseDetail.window")}
            </p>
            <p class="mt-1 font-semibold">
              {assessment.opensAt.slice(0, 10)} &rarr; {assessment.closesAt.slice(0, 10)}
            </p>
          </div>
        </div>
      </a>
    {/each}
  </div>
</section>
