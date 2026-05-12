<script lang="ts">
  import { page } from "$app/state";
  import Plus from "@lucide/svelte/icons/plus";
  import Lock from "@lucide/svelte/icons/lock";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Shield from "@lucide/svelte/icons/shield";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { exams, canCreate } = $derived(data);
  const courseId = $derived(page.params.courseId ?? "");

  const monthFormatter = $derived(
    new Intl.DateTimeFormat(getLocale(), { month: "short" })
  );

  function pad2(n: number): string {
    return n < 10 ? `0${String(n)}` : String(n);
  }

  function dateBlockParts(iso: string | null): { month: string; day: string; time: string } {
    if (!iso) {
      return {
        month: m.examsList_draftMonth(),
        day: m.examsList_draftDay(),
        time: m.examsList_draftTime()
      };
    }
    const d = new Date(iso);
    return {
      month: monthFormatter.format(d),
      day: pad2(d.getDate()),
      time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    };
  }

  function formatHHMM(iso: string): string {
    const d = new Date(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatTimeRangeForCard(
    startsAt: string,
    endsAt: string,
    endedStyle: boolean
  ): string {
    const s = new Date(startsAt);
    const range = `${formatHHMM(startsAt)} - ${formatHHMM(endsAt)}`;
    if (endedStyle) {
      const md = `${s.getMonth() + 1}/${s.getDate()}`;
      return `${md} ${range}`;
    }
    return range;
  }

  function minutesLeft(endsAt: string | null): number {
    if (!endsAt) return 0;
    return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 60_000));
  }

  function upcomingHint(startsAt: string | null): string | null {
    if (!startsAt) return null;
    const msUntil = new Date(startsAt).getTime() - Date.now();
    if (msUntil <= 0) return null;
    const hours = Math.floor(msUntil / (60 * 60 * 1000));
    if (hours < 24) return m.examsList_hoursLeft({ count: Math.max(1, hours) });
    const days = Math.ceil(msUntil / (24 * 60 * 60 * 1000));
    return m.examsList_opensInDays({ count: days });
  }

  function scoringLabel(mode: "problem_count" | "point_sum"): string {
    return mode === "problem_count"
      ? m.examsList_scoringProblemCount()
      : m.examsList_scoringPointSum();
  }

  function proctorTitle(
    name: "pageLock" | "ipBinding" | "ipWhitelist",
    enabled: boolean
  ): string {
    const label =
      name === "pageLock"
        ? m.examsList_proctorPageLock()
        : name === "ipBinding"
          ? m.examsList_proctorIpBinding()
          : m.examsList_proctorIpWhitelist();
    return enabled ? label : m.examsList_proctorDisabled({ name: label });
  }
</script>

<div class="space-y-6 pb-20">
  {#if canCreate}
    <div class="animate-in animate-in-1 flex justify-end">
      <Button href={`/courses/${courseId}/exams/new`}>
        <Plus class="h-4 w-4" />
        {m.examsList_createNew()}
      </Button>
    </div>
  {/if}

  {#if exams.length === 0}
    <div
      class="animate-in animate-in-2 rounded-xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
    >
      {m.examsList_empty()}
    </div>
  {:else}
    <div class="animate-in animate-in-2 grid gap-3">
      {#each exams as exam (exam.id)}
        {@const isRunning = exam.status === "running"}
        {@const isDraft = exam.status === "draft"}
        {@const isEnded = exam.status === "ended"}
        {@const isUpcoming = exam.status === "upcoming"}
        {@const dateParts = dateBlockParts(exam.startsAt)}
        {@const upcHint = upcomingHint(exam.startsAt)}
        <a
          href={`/exams/${exam.id}`}
          class="group relative grid grid-cols-[auto_1fr_auto] items-center gap-6 overflow-hidden rounded-xl border px-7 py-6 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-fast ease-out-soft hover:translate-x-[3px] hover:border-border-strong hover:shadow-rest {isDraft
            ? 'border-dashed border-border bg-transparent'
            : 'border-border bg-[color:var(--color-panel)]'}"
        >
          <!-- Left status indicator strip -->
          <span
            class="pointer-events-none absolute left-0 top-0 bottom-0 w-[4px] {isUpcoming
              ? 'bg-info'
              : isRunning
                ? 'bg-primary'
                : isDraft
                  ? 'bg-muted-foreground/40'
                  : 'bg-muted-foreground'}"
            aria-hidden="true"
          ></span>

          <!-- Date block -->
          <div
            class="min-w-[72px] rounded-md border px-3 py-2 text-center {isRunning
              ? 'border-[color:var(--color-primary)]/28 bg-[color:var(--color-primary)]/8'
              : isDraft
                ? 'border-dashed border-border bg-[color:var(--color-panel)]/60 opacity-70'
                : isEnded
                  ? 'border-border bg-[color:var(--color-panel)]/60 opacity-60'
                  : 'border-border bg-[color:var(--color-panel)]/60'}"
          >
            <div class="text-caption font-semibold uppercase tracking-[0.1em] text-primary">
              {dateParts.month}
            </div>
            <div class="mt-0.5 text-title-lg font-medium leading-none">
              {dateParts.day}
            </div>
            <div class="mt-1 font-mono text-micro text-muted-foreground">
              {dateParts.time}
            </div>
          </div>

          <!-- Middle: title + meta -->
          <div class="min-w-0">
            <div class="flex items-center gap-3">
              <h3 class="truncate text-title-sm font-semibold tracking-[-0.01em]">
                {exam.title}
              </h3>
              {#if isRunning}
                <span
                  class="live-pulse inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-primary)]/12 px-2.5 py-1 text-caption font-semibold tracking-[0.04em] text-primary"
                >
                  <span
                    class="live-dot h-1.5 w-1.5 rounded-full bg-primary"
                    aria-hidden="true"
                  ></span>
                  {m.examsList_liveChip()}
                </span>
              {/if}
            </div>
            <div
              class="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-body-sm text-muted-foreground"
            >
              {#if exam.startsAt && exam.endsAt}
                <span class="font-mono tabular-nums">
                  {formatTimeRangeForCard(exam.startsAt, exam.endsAt, isEnded)}
                  {#if exam.durationMinutes !== null}
                    · {m.examsList_duration({ count: exam.durationMinutes })}
                  {/if}
                </span>
              {:else}
                <span class="opacity-70">{m.examsList_draftNoSchedule()}</span>
              {/if}

              {#if !isDraft}
                <span
                  class="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <span>{scoringLabel(exam.scoringMode)}</span>
                {#if exam.problemCount > 0}
                  <span>
                    · {m.examsList_problemCount({ count: exam.problemCount })}
                  </span>
                {/if}
              {/if}

              {#if isUpcoming}
                <span
                  class="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <Badge variant="info" dot size="sm">{m.examsList_statusUpcoming()}</Badge>
                {#if upcHint}
                  <span
                    class="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground"
                    aria-hidden="true"
                  ></span>
                  <span>{upcHint}</span>
                {/if}
              {/if}

              {#if isEnded}
                <span
                  class="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <Badge variant="muted" size="sm">{m.examsList_statusEnded()}</Badge>
              {/if}

              {#if isDraft}
                <span
                  class="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <Badge variant="muted" size="sm">{m.examsList_statusDraft()}</Badge>
                <span
                  class="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <span class="font-medium text-primary">{m.examsList_draftHint()}</span>
              {/if}

              {#if !isDraft}
                <span
                  class="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <div
                  class="inline-flex items-center gap-1.5"
                  aria-label={m.examsList_proctoringLabel()}
                >
                  <span
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors {exam
                      .proctoring.pageLock
                      ? 'bg-[color:var(--color-primary)]/14 text-primary'
                      : 'bg-muted text-muted-foreground'}"
                    title={proctorTitle("pageLock", exam.proctoring.pageLock)}
                  >
                    <Lock class="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors {exam
                      .proctoring.ipBinding
                      ? 'bg-[color:var(--color-primary)]/14 text-primary'
                      : 'bg-muted text-muted-foreground'}"
                    title={proctorTitle("ipBinding", exam.proctoring.ipBinding)}
                  >
                    <Link2 class="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors {exam
                      .proctoring.ipWhitelist
                      ? 'bg-[color:var(--color-primary)]/14 text-primary'
                      : 'bg-muted text-muted-foreground'}"
                    title={proctorTitle("ipWhitelist", exam.proctoring.ipWhitelist)}
                  >
                    <Shield class="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </div>
              {/if}
            </div>
          </div>

          <!-- Right: countdown / class stats -->
          <div class="flex min-w-[200px] items-center justify-end gap-6">
            {#if isRunning}
              <div class="text-title font-medium tabular-nums">
                {minutesLeft(exam.endsAt)}<span
                  class="ml-1 text-caption font-normal text-muted-foreground"
                  >{m.examsList_minLeft()}</span
                >
              </div>
            {/if}

            <div
              class="text-right font-mono text-caption text-muted-foreground tabular-nums leading-[1.4]"
            >
              {#if isDraft}
                <span class="block text-title-sm font-medium text-foreground"
                  >—</span
                >
                {m.examsList_teacherOnlyHint()}
              {:else if exam.registeredCount !== null && exam.totalStudents !== null}
                <span class="block text-title-sm font-medium text-foreground">
                  {exam.registeredCount}/{exam.totalStudents}
                </span>
                {isRunning
                  ? m.examsList_entered()
                  : isEnded
                    ? m.examsList_answered()
                    : m.examsList_registered()}
              {:else if exam.myStatus}
                <span class="block text-title-sm font-medium text-foreground">
                  {exam.myStatus.score}/{exam.myStatus.totalPoints}
                </span>
                {m.courseOverview_scoreCaption()}
              {:else}
                <span class="block text-title-sm font-medium text-foreground"
                  >—</span
                >
                {m.examsList_classStatsPendingTeacher()}
              {/if}
            </div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .live-dot {
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--color-primary) 20%, transparent);
    animation: pulse-dot 2s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%,
    100% {
      box-shadow: 0 0 0 4px color-mix(in oklab, var(--color-primary) 20%, transparent);
    }
    50% {
      box-shadow: 0 0 0 8px color-mix(in oklab, var(--color-primary) 0%, transparent);
    }
  }
</style>
