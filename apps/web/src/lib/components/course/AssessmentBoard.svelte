<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import type { courseDomain } from "@nojv/domain";
  import { Badge } from "$lib/components/ui/badge";
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
  class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm shadow-rest"
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-caption uppercase tracking-[0.18em] text-muted-foreground">
        {m.courseDetail_assessmentBoard()}
      </p>
      <h3 class="mt-1 text-title font-semibold">
        {m.courseDetail_assessmentBoardSubtitle()}
      </h3>
    </div>
    <Badge variant="muted">
      <span class="tabular-nums">{assessments.length}</span>
      {m.common_assessments()}
    </Badge>
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
        class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] px-4 py-4 shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:shadow-hover motion-safe:hover:-translate-y-0.5"
        {href}
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="mt-2 text-body-lg font-semibold">{assessment.title}</p>
            <p class="mt-3 text-body-sm leading-relaxed text-muted-foreground">
              {assessment.summary}
            </p>
          </div>
          <div class="text-right">
            <Badge variant="muted">
              {windowState}
            </Badge>
            <p class="mt-2 text-body-sm text-muted-foreground">
              <span class="tabular-nums">{assessment.problemIds.length}</span>
              {m.contestDetail_problems()}
            </p>
          </div>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p class="text-body-sm text-muted-foreground">
              {m.courseDetail_framing()}
            </p>
            <p class="mt-1 font-semibold">{presentation.heroLabel}</p>
          </div>
          <div>
            <p class="text-body-sm text-muted-foreground">
              {m.courseDetail_window()}
            </p>
            <p class="mt-1 font-semibold tabular-nums">
              {assessment.opensAt.slice(0, 10)} &rarr; {assessment.closesAt.slice(0, 10)}
            </p>
          </div>
        </div>
      </a>
    {/each}
  </div>
</section>
