<script lang="ts">
  import { Check } from "@lucide/svelte";

  type TabKey = "sample1" | "sample2" | "custom";
  let activeTab = $state<TabKey>("sample1");
</script>

<div
  class="flex min-h-0 flex-col border-t border-border-subtle"
  style="background: color-mix(in oklab, var(--muted) 60%, transparent);"
>
  <div class="flex items-center gap-1 px-3 pt-2 text-caption">
    <button
      type="button"
      onclick={() => (activeTab = "sample1")}
      class="rounded-t-md px-3 py-1 font-mono text-micro uppercase tracking-wider {activeTab ===
      'sample1'
        ? 'text-foreground'
        : 'text-muted-foreground'}"
      style:background={activeTab === "sample1" ? "var(--panel)" : undefined}
      style:border-top={activeTab === "sample1" ? "1px solid var(--border-subtle)" : undefined}
      style:border-left={activeTab === "sample1" ? "1px solid var(--border-subtle)" : undefined}
      style:border-right={activeTab === "sample1" ? "1px solid var(--border-subtle)" : undefined}
    >
      Sample 1
    </button>
    <button
      type="button"
      onclick={() => (activeTab = "sample2")}
      class="px-3 py-1 font-mono text-micro uppercase tracking-wider {activeTab ===
      'sample2'
        ? 'text-foreground'
        : 'text-muted-foreground'}"
    >
      Sample 2
    </button>
    <button
      type="button"
      onclick={() => (activeTab = "custom")}
      class="px-3 py-1 font-mono text-micro uppercase tracking-wider {activeTab ===
      'custom'
        ? 'text-foreground'
        : 'text-muted-foreground'}"
    >
      Custom
    </button>
    <span
      class="verdict-ac ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-caption uppercase tracking-wider"
    >
      <Check class="size-3" strokeWidth={3} /> Passed · 14ms
    </span>
  </div>
  <div
    class="grid flex-1 grid-cols-2 gap-px overflow-hidden"
    style="background: var(--border-subtle);"
  >
    <div class="overflow-auto p-3" style="background: var(--panel);">
      <div
        class="mb-1 font-mono text-micro uppercase tracking-wider text-muted-foreground"
      >
        stdin
      </div>
      <pre class="font-mono text-caption">5
3 1 4 1 5</pre>
    </div>
    <div class="overflow-auto p-3" style="background: var(--panel);">
      <div class="mb-1 flex items-center gap-2">
        <span class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >stdout</span
        >
        <span
          class="font-mono text-micro uppercase tracking-wider"
          style="color: oklch(0.45 0.13 160);"
        >
          = expected
        </span>
      </div>
      <pre class="font-mono text-caption">10</pre>
    </div>
  </div>
</div>
