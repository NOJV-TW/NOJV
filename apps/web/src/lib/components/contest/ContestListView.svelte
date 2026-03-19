<script lang="ts">
  import type { AssessmentScoreboardMode, ContestScoringMode, Language } from "@nojv/core";
  import { getLocale } from "$lib/paraglide/runtime.js";

  interface ContestItem {
    allowedLanguages: Language[];
    endsAt: string;
    ipBindingEnabled: boolean;
    ipWhitelistEnabled: boolean;
    maxAttempts: number | null;
    pageLockEnabled: boolean;
    participantCount: number;
    problemCount: number;
    scoreboardMode: AssessmentScoreboardMode;
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

    if (now < start) return { color: "text-blue-600 dark:text-blue-400", label: "Upcoming" };
    if (now <= end) return { color: "text-emerald-600 dark:text-emerald-400", label: "Active" };
    return { color: "text-[color:var(--color-muted-foreground)]", label: "Ended" };
  }

  function formatFeatures(c: ContestItem): string {
    const parts = [c.scoringMode, `${c.problemCount} problems`, `${c.participantCount} participants`];
    if (c.scoreboardMode === "frozen") parts.push("frozen scoreboard");
    if (c.pageLockEnabled) parts.push("page lock");
    if (c.ipWhitelistEnabled) parts.push("IP whitelist");
    if (c.ipBindingEnabled) parts.push("IP binding");
    if (c.maxAttempts != null) parts.push(`${c.maxAttempts} attempts`);
    if (c.allowedLanguages.length > 0) parts.push(c.allowedLanguages.join(", "));
    return parts.join(" \u00b7 ");
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
            {formatFeatures(c)}
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
