<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";

  let { data } = $props();

  function windowStateBadgeVariant(state: string): "success" | "info" | "muted" | "warning" {
    const s = state.toLowerCase();
    if (s.includes("open") || s.includes("active") || s.includes("running")) return "success";
    if (s.includes("upcoming") || s.includes("pending")) return "info";
    if (s.includes("closed") || s.includes("ended") || s.includes("archived")) return "muted";
    return "warning";
  }
</script>

<div class="space-y-6">
  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 shadow-rest backdrop-blur-sm sm:px-8"
  >
    <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
      {m.navigation_courses()} / {data.course.slug} / assignment
    </p>
    <h2 class="mt-2 font-display text-headline">
      {data.assessment.title}
    </h2>
    <p class="mt-4 max-w-3xl text-body leading-7 text-muted-foreground">
      {data.assessment.summary}
    </p>
  </section>

  <section class="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
    <div
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
    >
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
            {m.assessment_assignmentFraming()}
          </p>
          <h3 class="mt-1 text-title font-semibold">{data.presentation.heroLabel}</h3>
        </div>
        <Badge variant={windowStateBadgeVariant(data.windowState)} dot>
          {data.windowState}
        </Badge>
      </div>
      <div class="mt-5 space-y-3">
        {#each data.problems as problem (problem.id)}
          <a
            class="flex items-center justify-between gap-4 rounded-xl border border-border bg-[color:var(--color-panel)] px-4 py-4 shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover"
            href="/problems/{problem.id}?course={data.course.slug}&assessment={data.assessment.slug}"
          >
            <div>
              <p
                class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground"
              >
                {problem.visibility}
              </p>
              <p class="mt-1 text-body-lg font-semibold">{problem.title}</p>
            </div>
            <Badge variant="outline">{m.assessment_openInEditor()}</Badge>
          </a>
        {/each}
      </div>
    </div>

    <aside class="space-y-6">
      <section
        class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-5 shadow-rest backdrop-blur-sm"
      >
        <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
          {m.common_timeline()}
        </p>
        <div class="mt-4 space-y-3 text-body-sm leading-7 text-muted-foreground">
          <p class="tabular-nums">{m.assessment_opens()}: {data.assessment.opensAt}</p>
          <p class="tabular-nums">{m.assessment_due()}: {data.assessment.dueAt ?? "—"}</p>
          <p class="tabular-nums">{m.assessment_closes()}: {data.assessment.closesAt}</p>
        </div>
      </section>
      <section
        class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-5 shadow-rest backdrop-blur-sm"
      >
        <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
          {m.assessment_whyDiffers()}
        </p>
        <p class="mt-3 text-body-sm leading-7 text-muted-foreground">
          {m.assessment_assignmentExplanation()}
        </p>
      </section>
    </aside>
  </section>
</div>
