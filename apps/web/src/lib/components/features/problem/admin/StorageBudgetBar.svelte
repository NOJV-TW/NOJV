<script lang="ts">
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatBudget } from "$lib/utils/storage-budget-format";

  interface Props {
    problemId: string;
    refreshToken?: number;
  }

  let { problemId, refreshToken = 0 }: Props = $props();

  let used = $state(0);
  let limit = $state(50 * 1024 * 1024);
  let loaded = $state(false);

  async function load() {
    try {
      const res = await fetch(`/api/problems/${problemId}/storage-usage`);
      if (!res.ok) return;
      const json = (await res.json()) as { used: number; limit: number };
      used = json.used;
      limit = json.limit;
      loaded = true;
    } catch {
      // Soft failure — render a neutral bar; uploads still work, the
      // server enforces the budget.
    }
  }

  onMount(load);

  $effect(() => {
    if (refreshToken > 0) void load();
  });

  let pct = $derived(limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);
  let isOver = $derived(used > limit);
</script>

<div class="space-y-1.5" aria-label={m.storageBudget_label()}>
  <div class="flex items-baseline justify-between gap-2">
    <span class="text-caption font-medium text-muted-foreground">
      {m.storageBudget_label()}
    </span>
    <span
      class="font-mono text-caption {isOver
        ? 'text-destructive'
        : 'text-muted-foreground'}"
    >
      {loaded ? formatBudget(used, limit) : "…"}
    </span>
  </div>
  <div
    class="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={pct}
  >
    <div
      class="h-full transition-[width] duration-fast ease-out-soft {isOver
        ? 'bg-destructive'
        : pct > 80
          ? 'bg-warning'
          : 'bg-primary'}"
      style="width: {pct}%"
    ></div>
  </div>
</div>
