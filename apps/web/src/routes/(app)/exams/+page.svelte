<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ChevronRight, Info } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { buttonVariants } from "$lib/components/ui/button";
  import FilterChips from "$lib/components/common/FilterChips.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { exams, counts, currentFilter } = $derived(data);

  function setFilter(next: string) {
    const url = new URL(page.url);
    if (next === "all") url.searchParams.delete("status");
    else url.searchParams.set("status", next);
    goto(`?${url.searchParams.toString()}`, {
      keepFocus: true,
      replaceState: true,
      noScroll: true
    });
  }

  const filterOptions = $derived([
    { value: "all", label: m.examsTop_filterAll(), count: counts.all },
    {
      value: "running",
      label: m.examsTop_filterRunning(),
      count: counts.running
    },
    {
      value: "upcoming",
      label: m.examsTop_filterUpcoming(),
      count: counts.upcoming
    },
    { value: "ended", label: m.examsTop_filterEnded(), count: counts.ended }
  ]);

  // Compact "Apr 17" / "15:00" parts for the date block. Uses Latin
  // month abbrevs to match the prototype — the rest of the row uses
  // localised paraglide copy.
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ] as const;

  function pad2(n: number): string {
    return n < 10 ? `0${String(n)}` : String(n);
  }

  function dateBlock(iso: string) {
    const d = new Date(iso);
    return {
      month: MONTHS[d.getMonth()],
      day: String(d.getDate()),
      time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    };
  }

  function timeRange(startIso: string, endIso: string) {
    const s = new Date(startIso);
    const e = new Date(endIso);
    return {
      start: `${s.getMonth() + 1}/${s.getDate()} ${pad2(s.getHours())}:${pad2(s.getMinutes())}`,
      end: `${e.getMonth() + 1}/${e.getDate()} ${pad2(e.getHours())}:${pad2(e.getMinutes())}`
    };
  }

  /**
   * Right-side hint for running/upcoming. Returns `null` for ended.
   * Running -> "{minutes} min" remaining (rounded down).
   * Upcoming -> "{days} days remaining" (rounded up to next day).
   */
  function rightHint(
    status: "running" | "upcoming" | "ended",
    startIso: string,
    endIso: string
  ): string | null {
    const now = Date.now();
    if (status === "running") {
      const msLeft = new Date(endIso).getTime() - now;
      if (msLeft <= 0) return null;
      const minutesLeft = Math.max(1, Math.floor(msLeft / 60_000));
      return m.examsTop_minRemaining({ minutes: minutesLeft });
    }
    if (status === "upcoming") {
      const msUntil = new Date(startIso).getTime() - now;
      if (msUntil <= 0) return null;
      const daysUntil = Math.max(1, Math.ceil(msUntil / (24 * 60 * 60 * 1000)));
      return m.examsTop_daysRemaining({ days: daysUntil });
    }
    return null;
  }

  function scoringLabel(mode: "problem_count" | "point_sum"): string {
    return mode === "point_sum" ? m.examsTop_scoringIoi() : m.examsTop_scoringIcpc();
  }
</script>

<div class="pb-24">
  <!-- Page head -->
  <header class="animate-in mb-8">
    <p class="text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {m.examsTop_eyebrow()}
    </p>
    <h1 class="font-display mt-2 text-display font-medium tracking-[-0.02em]">
      {m.examsTop_title()}
    </h1>
    <p class="mt-2 text-body text-muted-foreground">
      {m.examsTop_subtitle()}
    </p>
  </header>

  <!-- Filter chips -->
  <div class="animate-in animate-in-1 mb-6 flex flex-wrap items-center gap-4">
    <div class="flex-1">
      <FilterChips value={currentFilter} onChange={setFilter} options={filterOptions} />
    </div>
  </div>

  {#if exams.length === 0}
    <div
      class="animate-in animate-in-2 rounded-2xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center"
    >
      <h2 class="font-display text-title font-medium">
        {m.examsTop_empty()}
      </h2>
      <p class="mt-2 text-body-sm text-muted-foreground">
        {m.examsTop_emptyDescription()}
      </p>
    </div>
  {:else}
    <div class="animate-in animate-in-2 grid gap-3">
      {#each exams as exam (exam.id)}
        {@const date = dateBlock(exam.startsAt)}
        {@const range = timeRange(exam.startsAt, exam.endsAt)}
        {@const hint = rightHint(exam.status, exam.startsAt, exam.endsAt)}
        {@const accent = exam.status === "running"
          ? "bg-primary"
          : exam.status === "upcoming"
            ? "bg-info"
            : "bg-muted-foreground"}
        <a
          href={`/courses/${exam.courseId}/exams/${exam.id}`}
          class="group relative grid grid-cols-[auto_1fr_auto] items-center gap-6 overflow-hidden rounded-2xl border border-border bg-[color:var(--color-panel)] px-7 py-6 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-fast ease-out-soft hover:translate-x-[3px] hover:border-border-strong hover:shadow-rest"
        >
          <!-- Left status accent bar (always visible, color by status) -->
          <span
            class={"pointer-events-none absolute left-0 top-0 bottom-0 w-[4px] " + accent}
            aria-hidden="true"
          ></span>

          <!-- Date block -->
          <div
            class={"min-w-[78px] rounded-md border px-3 py-2 text-center " +
              (exam.status === "running"
                ? "border-primary/30 bg-primary/[0.08]"
                : exam.status === "ended"
                  ? "border-border bg-[color:var(--color-panel)]/60 opacity-65"
                  : "border-border bg-[color:var(--color-panel)]/60")}
          >
            <div
              class="text-caption font-semibold uppercase tracking-[0.1em] text-primary"
            >
              {date.month}
            </div>
            <div class="font-display mt-0.5 text-title-lg font-medium leading-none">
              {date.day}
            </div>
            <div class="mt-1 font-mono text-micro text-muted-foreground">
              {date.time}
            </div>
          </div>

          <!-- Content -->
          <div class="min-w-0">
            <!-- Course tag pill (inline div, not <a>, since the card itself is a link) -->
            <div
              class="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--color-panel)] px-2.5 py-1 text-caption font-semibold text-muted-foreground"
            >
              <span
                class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              ></span>
              <span class="truncate">{exam.courseTitle}</span>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <h3 class="font-sans text-title-sm font-semibold tracking-[-0.01em]">
                {exam.title}
              </h3>
              {#if exam.status === "running"}
                <span
                  class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-caption font-semibold tracking-[0.04em] text-primary"
                >
                  <span
                    class="exam-live-dot h-[7px] w-[7px] rounded-full bg-primary"
                    aria-hidden="true"
                  ></span>
                  {m.examsTop_liveChip()}
                </span>
              {/if}
            </div>
            <div
              class="mt-2 flex items-center gap-2.5 font-mono text-caption text-muted-foreground tabular-nums"
            >
              <span>{range.start}</span>
              <span class="opacity-50">→</span>
              <span>{range.end}</span>
              <span class="opacity-50">·</span>
              <span>{m.examsTop_duration({ count: exam.durationMinutes })}</span>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
              <span>{scoringLabel(exam.scoringMode)}</span>
              {#if exam.status === "upcoming"}
                <span
                  class="inline-block h-[3px] w-[3px] rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <Badge variant="info" dot size="sm">
                  {hint ?? m.examsTop_filterUpcoming()}
                </Badge>
              {:else if exam.status === "ended"}
                <span
                  class="inline-block h-[3px] w-[3px] rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <Badge variant="muted" size="sm">{m.examsTop_filterEnded()}</Badge>
              {/if}
            </div>
          </div>

          <!-- Right block -->
          <div class="flex items-center gap-4">
            {#if exam.status === "running"}
              {#if hint}
                <div
                  class="font-display rounded-md border border-primary/25 bg-primary/[0.08] px-4 py-2 text-title-sm font-medium tabular-nums text-primary"
                >
                  {hint}
                </div>
              {/if}
              <span class={buttonVariants({ variant: "default", size: "default" })}>
                {m.examsTop_enterExam()}
                <ChevronRight class="h-4 w-4" />
              </span>
            {:else if exam.status === "upcoming"}
              <div class="text-right text-caption text-muted-foreground">
                {m.examsTop_registered()}<br />
                <span class="font-medium text-foreground">{m.examsTop_canAnswer()}</span>
              </div>
            {:else}
              <span class={buttonVariants({ variant: "outline", size: "sm" })}>
                {m.examsTop_viewResults()}
              </span>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}

  <!-- Info note -->
  <div
    class="animate-in animate-in-3 mt-6 flex gap-3 rounded-md border border-info/25 border-l-[4px] border-l-info bg-info/[0.06] px-4 py-3 text-body-sm leading-snug text-muted-foreground"
  >
    <Info class="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
    <div>
      {m.examsTop_infoBody()}
      <a href="/contests" class="font-medium text-primary hover:underline"
        >{m.examsTop_infoLinkContests()}</a
      >
    </div>
  </div>
</div>

<style>
  .exam-live-dot {
    animation: exam-pulse-dot 2s ease-in-out infinite;
  }
  @keyframes exam-pulse-dot {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(196, 104, 45, 0.4);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(196, 104, 45, 0);
    }
  }
</style>
