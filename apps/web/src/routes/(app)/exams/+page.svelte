<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ChevronRight, ClipboardList } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { buttonVariants } from "$lib/components/ui/button";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { exams, counts, currentFilter } = $derived(data);

  function setTab(next: string) {
    const url = new URL(page.url);
    if (next === "all") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    goto(`?${url.searchParams.toString()}`, {
      keepFocus: true,
      replaceState: true,
      noScroll: true
    });
  }

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
      return `${minutesLeft} ${m.examsTop_minLeft()}`;
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
    return mode === "point_sum"
      ? m.examsTop_scoringPointSum()
      : m.examsTop_scoringProblemCount();
  }
</script>

<div class="pb-24">
  <!-- Page head -->
  <header class="animate-in mb-8">
    <h1 class="font-display text-display font-medium tracking-[-0.02em]">
      {m.navigation_exams()}
    </h1>
    <p class="mt-2 text-body text-muted-foreground">
      {m.examsTop_subtitle()}
    </p>
  </header>

  <!-- Tab row -->
  <div class="animate-in animate-in-1 mb-6 flex items-center gap-4 border-b border-border">
    <div role="tablist" aria-label={m.navigation_exams()} class="flex flex-1 items-center gap-1">
      {#each [{ key: "all", label: m.examsTop_filterAll(), count: counts.all }, { key: "running", label: m.examsTop_filterRunning(), count: counts.running }, { key: "upcoming", label: m.examsTop_filterUpcoming(), count: counts.upcoming }, { key: "ended", label: m.examsTop_filterEnded(), count: counts.ended }] as tab (tab.key)}
        {@const isActive = tab.key === currentFilter}
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          onclick={() => setTab(tab.key)}
          class="-mb-px inline-flex items-center gap-2 border-b-2 px-5 py-3.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft {isActive
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
        >
          <span>{tab.label}</span>
          <span
            class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums {isActive
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'}"
          >
            {tab.count}
          </span>
        </button>
      {/each}
    </div>
  </div>

  {#if exams.length === 0}
    <div
      class="animate-in animate-in-2 rounded-2xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center"
    >
      <ClipboardList
        class="mx-auto h-12 w-12 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <h2 class="font-display mt-3 text-title font-medium">
        {m.examsTop_empty()}
      </h2>
      <p class="mt-2 text-body-sm text-muted-foreground">
        {m.examsTop_emptyDescription()}
      </p>
      <a
        href="/courses"
        class={buttonVariants({ variant: "outline", size: "sm" }) + " mt-4 inline-flex"}
      >
        {m.common_browseMyCourses()}
      </a>
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
          href={`/exams/${exam.id}`}
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
              <span class="text-body-sm font-medium text-primary">
                {m.examsTop_filterRunning()}
              </span>
            {:else if exam.status === "upcoming"}
              <span class="text-body-sm font-medium text-muted-foreground/70">
                {m.examsTop_filterUpcoming()}
              </span>
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
