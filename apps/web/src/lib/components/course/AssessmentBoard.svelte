<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import type { courseDomain } from "@nojv/domain";
  type CourseAssessmentRecord = courseDomain.CourseAssessmentRecord;
  import {
    assessmentPath,
    assessmentPresentation,
    deriveAssessmentWindowState
  } from "$lib/types";

  interface Props {
    assessments: CourseAssessmentRecord[];
    courseSlug: string;
  }

  let { assessments, courseSlug }: Props = $props();
</script>

<section
  class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
        {m.courseDetail_assessmentBoard()}
      </p>
      <h3 class="mt-1 text-2xl font-semibold">
        {m.courseDetail_assessmentBoardSubtitle()}
      </h3>
    </div>
    <span
      class="rounded-full border border-border px-3 py-1 text-xs font-medium"
    >
      {assessments.length} {m.common_assessments()}
    </span>
  </div>
  <div class="mt-5 grid gap-4">
    {#each assessments as assessment (assessment.slug)}
      {@const presentation = assessmentPresentation}
      {@const windowState = deriveAssessmentWindowState({
        closesAt: assessment.closesAt,
        dueAt: assessment.dueAt,
        opensAt: assessment.opensAt
      })}
      {@const href = assessmentPath(courseSlug, assessment.slug)}
      <a
        class="rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-4 py-4 transition hover:-translate-y-0.5"
        {href}
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="mt-2 text-lg font-semibold">{assessment.title}</p>
            <p class="mt-3 text-sm leading-7 text-muted-foreground">
              {assessment.summary}
            </p>
          </div>
          <div class="text-right">
            <span
              class="rounded-full border border-border px-3 py-1 text-xs font-medium"
            >
              {windowState}
            </span>
            <p class="mt-2 text-sm text-muted-foreground">
              {assessment.problemSlugs.length} {m.contestDetail_problems()}
            </p>
          </div>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p class="text-sm text-muted-foreground">
              {m.courseDetail_framing()}
            </p>
            <p class="mt-1 font-semibold">{presentation.heroLabel}</p>
          </div>
          <div>
            <p class="text-sm text-muted-foreground">
              {m.courseDetail_window()}
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
