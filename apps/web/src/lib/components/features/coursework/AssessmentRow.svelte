<script lang="ts">
  import type { Snippet } from "svelte";
  import { Calendar, CalendarCheck2, CalendarClock, ChevronRight, Radio } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { typeAccentVar } from "./type-accent.js";
  import type { CourseworkKind } from "./StatusPill.svelte";

  interface Props {
    href: string;
    kind: CourseworkKind;
    typeLabel: string;
    context?: string;
    title: string;
    status: string;
    startsAt?: string | null;
    endsAt?: string | null;
    timing?: Snippet;
    foot?: Snippet;
    showStatusIcon?: boolean;
    delay?: number;
    class?: string;
  }

  let {
    href,
    kind,
    typeLabel,
    context,
    title,
    status,
    startsAt,
    endsAt,
    timing,
    foot,
    showStatusIcon = true,
    delay = 0,
    class: className,
  }: Props = $props();

  const accent = $derived(typeAccentVar(kind));

  function dateParts(dateIso: string | null | undefined) {
    if (!dateIso) return null;
    const date = new Date(dateIso);
    const pad2 = (value: number) => String(value).padStart(2, "0");
    return {
      month: new Intl.DateTimeFormat(getLocale(), { month: "short" }).format(date),
      day: pad2(date.getDate()),
      time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
    };
  }

  function statusLabel(): string {
    if (status === "draft") return m.statusPill_exam_draft();
    if (kind === "contest") {
      if (status === "live") return "LIVE";
      if (status === "upcoming") return m.statusPill_contest_upcoming();
      return m.statusPill_contest_ended();
    }
    if (kind === "exam") {
      if (status === "open") return m.statusPill_exam_open();
      if (status === "ended") return m.statusPill_exam_ended();
      if (status === "scheduled") return m.statusPill_exam_scheduled();
      return status === "submitted"
        ? m.statusPill_exam_submitted()
        : status === "in_progress"
          ? m.statusPill_exam_inProgress()
          : m.statusPill_exam_draft();
    }
    if (status === "closed") return m.statusPill_assignment_closed();
    if (status === "in_progress") return m.statusPill_assignment_inProgress();
    if (status === "submitted") return m.statusPill_assignment_submitted();
    return status === "not_started"
      ? m.statusPill_assignment_notStarted()
      : m.statusPill_exam_draft();
  }

  const startDate = $derived(dateParts(startsAt));
  const endDate = $derived(dateParts(endsAt));
</script>

<a
  {href}
  class={cn(
    "group glass hover-lift relative flex flex-wrap items-center gap-x-5 gap-y-3 overflow-hidden rounded-xl px-5 py-4 text-foreground no-underline shadow-rest",
    className,
  )}
  style="animation-delay: {delay}ms;"
>
  <span
    class="pointer-events-none absolute inset-y-0 left-0 w-1.5"
    style="background: {accent};"
    aria-hidden="true"
  ></span>

  {#if showStatusIcon}
    <div class="flex min-w-[2rem] shrink-0 items-center">
      <span class="inline-flex size-8 items-center justify-center" title={statusLabel()}>
        {#if status === "live" || status === "in_progress" || status === "open"}
          <Radio class="size-5 text-primary" aria-label={statusLabel()} />
        {:else if status === "ended" || status === "closed" || status === "submitted"}
          <CalendarCheck2 class="size-5 text-muted-foreground" aria-label={statusLabel()} />
        {:else if status === "draft"}
          <Calendar class="size-5 text-muted-foreground" aria-label={statusLabel()} />
        {:else}
          <CalendarClock class="size-5 text-primary" aria-label={statusLabel()} />
        {/if}
      </span>
    </div>
  {:else}
    <span class="sr-only">{statusLabel()}</span>
  {/if}

  {#if startDate || endDate}
    <div class="flex shrink-0 items-center gap-2">
      {#if startDate}
        <div
          class="flex min-w-[3rem] flex-col items-center justify-center rounded-md border border-border bg-[color:var(--color-panel)]/60 px-2 py-1 text-center leading-none"
          title={m.assessmentRow_start()}
        >
          <span class="text-micro font-semibold uppercase tracking-[0.08em] text-primary">
            {startDate.month}
          </span>
          <span class="mt-0.5 text-title-sm font-semibold tabular-nums">{startDate.day}</span>
          <span class="mt-1 font-mono text-micro tabular-nums text-muted-foreground">
            {startDate.time}
          </span>
        </div>
      {/if}
      {#if startDate && endDate}
        <span class="text-body-sm font-semibold text-muted-foreground" aria-hidden="true"
          >~</span
        >
      {/if}
      {#if endDate}
        <div
          class="flex min-w-[3rem] flex-col items-center justify-center rounded-md border border-border bg-[color:var(--color-panel)]/60 px-2 py-1 text-center leading-none"
          title={m.assessmentRow_end()}
        >
          <span class="text-micro font-semibold uppercase tracking-[0.08em] text-primary">
            {endDate.month}
          </span>
          <span class="mt-0.5 text-title-sm font-semibold tabular-nums">{endDate.day}</span>
          <span class="mt-1 font-mono text-micro tabular-nums text-muted-foreground">
            {endDate.time}
          </span>
        </div>
      {/if}
    </div>
  {/if}

  <div class="min-w-0 flex-1 basis-[14rem]">
    <div class="truncate font-medium">{title}</div>
    <div
      class="mt-0.5 truncate text-caption font-mono uppercase tracking-wider text-muted-foreground"
    >
      {typeLabel}{context ? ` · ${context}` : ""}
    </div>
  </div>

  <div class="flex basis-full items-center justify-between gap-4 sm:basis-auto sm:justify-end">
    <div class="flex min-w-0 items-baseline gap-5 sm:gap-7">
      {#if timing}
        <div class="min-w-[8rem] text-right font-mono text-title-sm font-semibold tabular-nums">
          {@render timing()}
        </div>
      {/if}
      {#if foot}
        <div class="min-w-[5rem] text-right font-mono text-title-sm font-semibold tabular-nums">
          {@render foot()}
        </div>
      {/if}
    </div>
    <ChevronRight
      class="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
      aria-hidden="true"
    />
  </div>
</a>
