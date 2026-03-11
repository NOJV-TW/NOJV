<script lang="ts">
  import { t } from "svelte-i18n";

  let { data } = $props();
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-gradient-to-br from-white/90 to-stone-50/80 px-6 py-8 sm:px-8"
  >
    <div class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div>
        <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
          {$t("navigation.courses")} / {data.course.slug} / exam
        </p>
        <h2 class="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {data.assessment.title}
        </h2>
        <p class="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
          {data.assessment.summary}
        </p>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div
          class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <p class="text-sm text-[color:var(--color-muted)]">{$t("assessment.rankMode")}</p>
          <p class="mt-2 text-lg font-semibold">{data.assessment.scoreboardMode}</p>
        </div>
        <div
          class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <p class="text-sm text-[color:var(--color-muted)]">{$t("assessment.policy")}</p>
          <p class="mt-2 text-lg font-semibold">{$t("assessment.contestGrade")}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
    <div
      class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-6 py-6"
    >
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
            {$t("assessment.examFraming")}
          </p>
          <h3 class="mt-1 text-2xl font-semibold">{data.presentation.heroLabel}</h3>
        </div>
        <span
          class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
        >
          {data.windowState}
        </span>
      </div>
      <div class="mt-5 space-y-3">
        {#each data.problems as problem (problem.slug)}
          <a
            class="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 transition hover:-translate-y-0.5"
            href="/problems/{problem.slug}?course={data.course.slug}&assessment={data.assessment.slug}"
          >
            <div>
              <p
                class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]"
              >
                {problem.visibility}
              </p>
              <p class="mt-1 text-lg font-semibold">{problem.title}</p>
            </div>
            <span
              class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
            >
              {$t("assessment.examEditor")}
            </span>
          </a>
        {/each}
      </div>
    </div>

    <aside class="space-y-6">
      <section
        class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
      >
        <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
          {$t("assessment.liveRank")}
        </p>
        <p class="mt-4 text-sm text-[color:var(--color-muted)]">
          Leaderboard not yet available.
        </p>
      </section>
      <section
        class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
      >
        <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
          {$t("assessment.whyDiffers")}
        </p>
        <p class="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
          {$t("assessment.examExplanation")}
        </p>
      </section>
    </aside>
  </section>
</div>
