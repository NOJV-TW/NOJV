<script lang="ts" module>
  export interface TabStripItem {
    value: string;
    label: string;
  }
</script>

<script lang="ts">
  interface Props {
    tabs: TabStripItem[];
    active: string;
    onChange: (value: string) => void;
  }

  let { tabs, active, onChange }: Props = $props();
</script>

<div
  class="inline-flex rounded-full p-1 text-caption font-medium"
  style="background: var(--panel-strong); border: 1px solid var(--border-subtle);"
>
  {#each tabs as t (t.value)}
    <button
      type="button"
      onclick={() => onChange(t.value)}
      class="rounded-full px-3 py-1.5 transition-colors {active === t.value
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
    >
      {t.label}
    </button>
  {/each}
</div>
