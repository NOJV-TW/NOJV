<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  let { data } = $props();
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 backdrop-blur-sm sm:px-8"
  >
    <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
      {m.navigation_courses()} / {data.course.slug} / assignment
    </p>
    <h2 class="mt-2 font-[family-name:var(--font-display)] text-4xl">
      {data.assessment.title}
    </h2>
    <p class="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
      {data.assessment.summary}
    </p>
  </section>

  <section class="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm"
    >
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
            {m.assessment_assignmentFraming()}
          </p>
          <h3 class="mt-1 text-2xl font-semibold">{data.presentation.heroLabel}</h3>
        </div>
        <span
          class="rounded-full border border-border px-3 py-1 text-xs font-medium"
        >
          {data.windowState}
        </span>
      </div>
      <div class="mt-5 space-y-3">
        {#each data.problems as problem (problem.id)}
          <a
            class="flex items-center justify-between gap-4 rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-4 py-4 transition hover:-translate-y-0.5"
            href="/problems/{problem.id}?course={data.course.slug}&assessment={data.assessment.slug}"
          >
            <div>
              <p
                class="text-sm uppercase tracking-[0.18em] text-muted-foreground"
              >
                {problem.visibility}
              </p>
              <p class="mt-1 text-lg font-semibold">{problem.title}</p>
            </div>
            <span
              class="rounded-full border border-border px-3 py-1 text-xs font-medium"
            >
              {m.assessment_openInEditor()}
            </span>
          </a>
        {/each}
      </div>
    </div>

    <aside class="space-y-6">
      <section
        class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
      >
        <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
          {m.common_timeline()}
        </p>
        <div class="mt-4 space-y-3 text-sm leading-7 text-muted-foreground">
          <p>{m.assessment_opens()}: {data.assessment.opensAt}</p>
          <p>{m.assessment_due()}: {data.assessment.dueAt ?? "—"}</p>
          <p>{m.assessment_closes()}: {data.assessment.closesAt}</p>
        </div>
      </section>
      <section
        class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
      >
        <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
          {m.assessment_whyDiffers()}
        </p>
        <p class="mt-3 text-sm leading-7 text-muted-foreground">
          {m.assessment_assignmentExplanation()}
        </p>
      </section>
    </aside>
  </section>
</div>
