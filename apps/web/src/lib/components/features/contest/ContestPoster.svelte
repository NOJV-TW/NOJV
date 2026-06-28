<script lang="ts">
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import StatusPill from "$lib/components/features/coursework/StatusPill.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { fmtDate } from "$lib/utils/datetime.js";

  interface Props {
    href: string;
    scoringLabel: string;
    status: "upcoming" | "live" | "ended";
    title: string;
    summary: string;
    startsAt: string;
    endsAt: string;
    durationMin: number;
    participants: number;
    delay?: number;
  }

  let {
    href,
    scoringLabel,
    status,
    title,
    summary,
    startsAt,
    endsAt,
    durationMin,
    participants,
    delay = 0,
  }: Props = $props();

  const isLive = $derived(status === "live");
</script>

<a
  {href}
  class="group relative glass hover-lift rounded-xl shadow-rest overflow-hidden fade-up block"
  style="animation-delay: {delay}ms; border-left: 4px solid {isLive
    ? 'var(--destructive)'
    : 'var(--primary)'};"
>
  <div
    class="relative grid items-stretch gap-0 sm:grid-cols-[1fr_auto]"
    style="min-height: 156px;"
  >
    <div class="p-6 lg:p-7 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {scoringLabel}
        </span>
        <StatusPill {status} type="contest" />
      </div>

      <h3 class="mt-2 text-title-lg lg:text-headline font-semibold tracking-tight line-clamp-2">
        {title}
      </h3>
      {#if summary}
        <p class="text-caption text-muted-foreground line-clamp-1">{summary}</p>
      {/if}

      <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-caption">
        <div>
          <span class="text-muted-foreground">{m.contestPoster_startLabel()}</span>
          <span class="font-mono tabular-nums">{fmtDate(startsAt)}</span>
        </div>
        <div>
          <span class="text-muted-foreground">{m.contestPoster_durationLabel()}</span>
          <span class="font-mono tabular-nums"
            >{m.contestPoster_durationMinutes({ count: durationMin })}</span
          >
        </div>
        <div>
          <span class="text-muted-foreground">{m.contestPoster_participantsLabel()}</span>
          <span class="font-mono tabular-nums"
            >{m.contestPoster_participantsCount({ count: participants })}</span
          >
        </div>
      </div>
    </div>

    <div
      class="self-stretch flex flex-col items-end justify-between p-6 sm:pl-6 lg:pr-7 sm:min-w-[260px] border-t sm:border-t-0 sm:border-l"
      style="border-color: var(--border-subtle); {isLive
        ? 'background: color-mix(in oklab, var(--destructive) 5%, transparent);'
        : 'background: color-mix(in oklab, var(--primary) 4%, transparent);'}"
    >
      <div class="w-full text-right">
        <div class="font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground">
          {isLive ? m.contestPoster_remaining() : m.contestPoster_untilStart()}
        </div>
        <div class="mt-1 flex justify-end">
          <Countdown iso={isLive ? endsAt : startsAt} />
        </div>
      </div>
      <div class="mt-4 flex items-center gap-2 text-caption">
        <span class="font-semibold" style="color: var(--primary);"
          >{m.contestPoster_enter()}</span
        >
      </div>
    </div>
  </div>
</a>
