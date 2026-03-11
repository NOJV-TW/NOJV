<script lang="ts">
  import { t } from "svelte-i18n";
  import type { CourseProblemCatalogEntry } from "$lib/server/course/queries";

  interface Props {
    courseSlug: string;
    problems: CourseProblemCatalogEntry[];
  }

  let { courseSlug, problems }: Props = $props();
</script>

<section
  class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
        {$t("courseDetail.problemShelf")}
      </p>
      <h3 class="mt-1 text-2xl font-semibold">
        {$t("courseDetail.problemShelfSubtitle")}
      </h3>
    </div>
    <span
      class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
    >
      {problems.length} {$t("courseDetail.linkedProblems")}
    </span>
  </div>
  <div class="mt-5 grid gap-3">
    {#each problems as problem (problem.slug)}
      <a
        class="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 transition hover:-translate-y-0.5"
        href="/problems/{problem.slug}?course={courseSlug}"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-lg font-semibold">{problem.title}</p>
            <p class="mt-2 text-sm leading-7 text-[color:var(--color-muted)]">
              {problem.summary}
            </p>
          </div>
          <div class="text-right">
            <span
              class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
            >
              {problem.visibility}
            </span>
            <p class="mt-2 text-sm text-[color:var(--color-muted)]">
              {$t("courseDetail.by")} {problem.authorHandle}
            </p>
          </div>
        </div>
      </a>
    {/each}
  </div>
</section>
