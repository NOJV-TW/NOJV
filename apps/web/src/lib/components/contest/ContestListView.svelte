<script lang="ts">
  import type { ContestScoringMode } from "@nojv/core";
  import { getLocale } from "$lib/paraglide/runtime.js";

  interface ContestItem {
    endsAt: string;
    participantCount: number;
    problemCount: number;
    scoringMode: ContestScoringMode;
    slug: string;
    startsAt: string;
    title: string;
  }

  interface Props {
    contests: ContestItem[];
  }

  let { contests }: Props = $props();
  let currentLocale = $derived(getLocale());

  function contestState(startsAt: string, endsAt: string): {
    color: string;
    label: string;
  } {
    const now = new Date();
    const start = new Date(startsAt);
    const end = new Date(endsAt);

    if (now < start) return { color: "text-blue-600", label: "Upcoming" };
    if (now <= end) return { color: "text-emerald-600", label: "Active" };
    return { color: "text-[color:var(--color-muted-foreground)]", label: "Ended" };
  }
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">Contests</h2>

  <section class="grid gap-4">
    {#each contests as c (c.slug)}
      {@const state = contestState(c.startsAt, c.endsAt)}
      <a
        class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] backdrop-blur-sm grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center transition hover:-translate-y-0.5"
        href="/contests/{c.slug}"
      >
        <div>
          <p class="text-xs text-muted-foreground uppercase tracking-wide">
            {c.scoringMode} &middot; {c.problemCount} problems &middot; {c.participantCount} participants
          </p>
          <h3 class="mt-1 text-xl font-semibold">{c.title}</h3>
        </div>
        <div>
          <p class="text-sm text-muted-foreground">Starts</p>
          <p class="mt-1 text-sm">
            {new Date(c.startsAt).toLocaleDateString(currentLocale)}
          </p>
        </div>
        <div>
          <p class="text-sm text-muted-foreground">Ends</p>
          <p class="mt-1 text-sm">
            {new Date(c.endsAt).toLocaleDateString(currentLocale)}
          </p>
        </div>
        <div class="sm:text-right">
          <span
            class="rounded-full border border-border px-3 py-1 text-xs font-medium {state.color}"
          >
            {state.label}
          </span>
        </div>
      </a>
    {/each}
  </section>
</div>
