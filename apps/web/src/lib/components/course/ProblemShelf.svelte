<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import type { courseDomain } from "@nojv/domain";
  import { Badge } from "$lib/components/ui/badge";
  type CourseProblemCatalogEntry = courseDomain.CourseProblemCatalogEntry;

  interface Props {
    courseSlug: string;
    problems: CourseProblemCatalogEntry[];
  }

  let { courseSlug, problems }: Props = $props();
</script>

<section
  class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm shadow-rest"
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-caption uppercase tracking-[0.18em] text-muted-foreground">
        {m.courseDetail_problemShelf()}
      </p>
      <h3 class="mt-1 text-title font-semibold">
        {m.courseDetail_problemShelfSubtitle()}
      </h3>
    </div>
    <Badge variant="muted">
      <span class="tabular-nums">{problems.length}</span>
      {m.courseDetail_linkedProblems()}
    </Badge>
  </div>
  <div class="mt-5 grid gap-3">
    {#each problems as problem (problem.id)}
      <a
        class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] px-4 py-4 shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:shadow-hover motion-safe:hover:-translate-y-0.5"
        href="/problems/{problem.id}?course={courseSlug}"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-body-lg font-semibold">{problem.title}</p>
            <p class="mt-2 text-body-sm leading-relaxed text-muted-foreground">
              {problem.summary}
            </p>
          </div>
          <div class="text-right">
            <Badge variant="muted">
              {problem.visibility}
            </Badge>
            <p class="mt-2 text-body-sm text-muted-foreground">
              {m.courseDetail_by()} {problem.authorUsername}
            </p>
          </div>
        </div>
      </a>
    {/each}
  </div>
</section>
