<script lang="ts">
  import { ListChecks, Lock } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import DifficultyTick from "$lib/components/primitives/visual/DifficultyTick.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";

  interface ProblemSummary {
    id: string;
    ordinal: number;
    points: number;
    title: string;
  }

  interface Props {
    problems: ProblemSummary[] | null;
    problemsHidden: boolean;
    contestId: string;
    isLive: boolean;
    isPast: boolean;
    isManager: boolean;
  }

  let { problems, problemsHidden, contestId, isLive, isPast, isManager }: Props = $props();

  function difficultyOf(p: { points: number }): "easy" | "medium" | "hard" {
    if (p.points >= 800) return "hard";
    if (p.points >= 400) return "medium";
    return "easy";
  }
</script>

<GlassPanel class="overflow-hidden">
  <div
    class="flex items-center justify-between px-6 py-4 border-b"
    style="border-color: var(--border-subtle);"
  >
    <h2 class="text-title font-semibold">{m.contestDetail_problemsHeading()}</h2>
    <div class="text-caption text-muted-foreground">
      {#if problemsHidden || problems === null}
        {m.contestDetail_problemsLockedHint()}
      {:else}
        {m.contestDetail_problemsMeta({
          count: problems.length,
          note: isPast
            ? m.contestDetail_problemsSortByDifficulty()
            : m.contestDetail_problemsUnlockOnStart()
        })}
      {/if}
    </div>
  </div>

  <div class="divide-y" style="border-color: var(--border-subtle);">
    {#if problemsHidden || problems === null}
      <EmptyState
        icon={Lock}
        title={m.contestDetail_problemsLockedTitle()}
        description={m.contestDetail_problemsLockedBody()}
      />
    {:else if problems.length === 0}
      <EmptyState
        icon={ListChecks}
        title={m.contestDetail_problemsEmptyTitle()}
        description={m.contestDetail_problemsEmptyBody()}
      />
    {:else}
      {#each problems as p (p.id)}
        {@const enterHref =
          isLive || isManager
            ? `/contests/${contestId}/problems/${p.id}`
            : isPast
              ? `/problems/${p.id}`
              : null}
        <a
          href={enterHref ?? "#"}
          class="grid grid-cols-[60px_1fr_auto] sm:grid-cols-[60px_1fr_minmax(120px,160px)_auto] items-center gap-4 px-6 py-3.5 transition-colors hover:bg-muted/40 {enterHref
            ? ''
            : 'pointer-events-none opacity-60'}"
          tabindex={enterHref ? 0 : -1}
          aria-disabled={enterHref ? undefined : true}
        >
          <div
            class="font-mono text-title font-semibold"
            style="color: var(--primary);"
          >
            {String.fromCharCode(64 + p.ordinal)}
          </div>
          <div class="min-w-0">
            <div class="font-medium truncate">{p.title}</div>
            <div class="mt-1 flex items-center gap-3">
              <DifficultyTick level={difficultyOf(p)} />
              <span
                class="text-micro font-mono uppercase tracking-wider text-muted-foreground tabular-nums"
              >
                {p.points} pts
              </span>
            </div>
          </div>
          <div class="hidden sm:block">
            <div
              class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
            >
              {m.contestDetail_problemDifficultyLabel()}
            </div>
            <div
              class="mt-1 h-1.5 rounded-full overflow-hidden"
              style="background: var(--muted);"
            >
              <div
                class="h-full rounded-full"
                style="width: {Math.min(100, (p.points / 1000) * 100)}%; background: var(--primary);"
              ></div>
            </div>
          </div>
          <span
            class="text-caption font-medium px-3 py-1.5 rounded-md border text-muted-foreground"
            style="border-color: var(--border-subtle); {enterHref ? '' : 'opacity: 0.5;'}"
          >
            {enterHref ? m.contestDetail_problemSolveCta() : "🔒"}
          </span>
        </a>
      {/each}
    {/if}
  </div>
</GlassPanel>
