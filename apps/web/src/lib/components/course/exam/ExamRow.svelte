<script lang="ts" module>
  const MONTHS = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC"
  ] as const;

  function pad2(n: number): string {
    return n < 10 ? `0${String(n)}` : String(n);
  }

  // Domain status → StatusPill exam status mapping. Domain has
  // running/upcoming/ended; StatusPill exam map has scheduled/open/
  // in_progress/submitted/graded. Pick the closest visual.
  function pillStatus(s: "running" | "upcoming" | "ended"): string {
    if (s === "running") return "in_progress";
    if (s === "upcoming") return "scheduled";
    return "graded";
  }
</script>

<script lang="ts">
  import { fmtWeekday } from "$lib/utils/datetime.js";
  import { m } from "$lib/paraglide/messages.js";
  import StatusPill from "$lib/components/coursework/StatusPill.svelte";
  import Countdown from "$lib/components/coursework/Countdown.svelte";
  import type { examDomain } from "@nojv/domain";

  interface Props {
    exam: examDomain.ExamAcrossRow;
    delay?: number;
  }

  let { exam, delay = 0 }: Props = $props();

  const startDate = $derived(new Date(exam.startsAt));
  const past = $derived(exam.status === "ended");

  const month = $derived(MONTHS[startDate.getMonth()]);
  const day = $derived(String(startDate.getDate()));
  const time = $derived(`${pad2(startDate.getHours())}:${pad2(startDate.getMinutes())}`);
  const weekday = $derived(fmtWeekday(exam.startsAt));
</script>

<a
  href={`/exams/${exam.id}`}
  class="group glass hover-lift fade-up block overflow-hidden rounded-2xl shadow-rest"
  style="animation-delay: {delay}ms"
>
  <div class="grid grid-cols-[136px_1fr] items-stretch md:grid-cols-[136px_1fr_auto]">
    <!-- Date gutter -->
    <div
      class="relative flex flex-col items-center justify-center border-r border-border-subtle px-3 py-5"
      style:background={past
        ? "var(--muted)"
        : "color-mix(in oklab, var(--primary) 8%, transparent)"}
    >
      <div
        class="font-mono text-caption font-semibold uppercase tracking-[0.18em] text-muted-foreground"
      >
        {month}
      </div>
      <div class="mt-1 text-headline font-bold leading-none">
        {day}
      </div>
      <div
        class="mt-1 whitespace-nowrap font-mono text-micro uppercase tracking-wider text-muted-foreground"
      >
        {m.coursework_weekdayPrefix({ day: weekday })} · {time}
      </div>
    </div>

    <!-- Body -->
    <div class="min-w-0 p-5">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="rounded border border-border-subtle px-1.5 py-0.5 font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground"
        >
          {exam.courseTitle}
        </span>
        <StatusPill status={pillStatus(exam.status)} type="exam" />
      </div>
      <h3 class="mt-2 text-title-lg font-semibold leading-tight">
        {exam.title}
      </h3>
      <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-caption">
        <span class="inline-flex items-baseline gap-1.5">
          <span class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
            >{m.examRow_durationLabel()}</span
          >
          <span class="font-mono">{m.examDetail_durationMinutes({ count: exam.durationMinutes })}</span>
        </span>
        <span class="inline-flex items-baseline gap-1.5">
          <span class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
            >{m.examRow_scoringLabel()}</span
          >
          <span class="font-mono"
            >{exam.scoringMode === "point_sum" ? m.examRow_scoringPointSum() : m.examRow_scoringProblemCount()}</span
          >
        </span>
      </div>
    </div>

    <!-- CTA strip -->
    <div
      class="hidden flex-col items-end justify-between gap-3 border-l border-border-subtle p-5 md:flex md:min-w-[200px]"
    >
      {#if exam.status === "upcoming"}
        <div>
          <div
            class="text-right font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            {m.examRow_ctaUpcoming()}
          </div>
          <div class="mt-1">
            <Countdown iso={exam.startsAt} compact />
          </div>
        </div>
        <div class="text-caption text-muted-foreground">{m.examRow_ctaViewDetails()}</div>
      {:else if exam.status === "running"}
        <div>
          <div
            class="text-right font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            {m.examRow_ctaRunning()}
          </div>
          <div class="mt-1">
            <Countdown iso={exam.endsAt} compact />
          </div>
        </div>
        <div class="text-caption text-primary">{m.examRow_ctaViewDetails()}</div>
      {:else}
        <div class="text-right">
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.examRow_ctaEnded()}
          </div>
          <div class="font-mono text-body-sm tabular-nums text-muted-foreground">
            {new Date(exam.endsAt).getMonth() + 1}/{new Date(exam.endsAt).getDate()}
          </div>
        </div>
        <div class="text-caption text-muted-foreground">{m.examRow_ctaViewDetails()}</div>
      {/if}
    </div>
  </div>
</a>
