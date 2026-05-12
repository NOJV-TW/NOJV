<script lang="ts">
  import { Flame } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/ui/card";

  interface Props {
    streakDays: number;
  }

  let { streakDays }: Props = $props();

  const isAlive = $derived(streakDays > 0);
</script>

<Card variant="surface" size="lg">
  <h2 class="mb-4 text-title-sm font-semibold">
    {m.dashboard_streakTitle()}
  </h2>
  <div class="flex items-center gap-4">
    <div
      class="flex h-14 w-14 items-center justify-center rounded-lg {isAlive
        ? 'bg-warning/15 text-warning'
        : 'bg-muted text-muted-foreground/70'}"
    >
      <Flame class="h-7 w-7" aria-hidden="true" />
    </div>
    <div class="flex flex-col gap-1">
      {#if isAlive}
        <span class="text-headline font-semibold tabular-nums">
          {streakDays}
        </span>
        <span class="text-caption text-muted-foreground">
          {m.dashboard_streakDays({ days: streakDays })}
        </span>
      {:else}
        <span class="text-body text-muted-foreground">
          {m.dashboard_streakBroken()}
        </span>
      {/if}
    </div>
  </div>
</Card>
