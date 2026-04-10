<script module lang="ts">
  export type UiLang = "zh" | "en";
</script>

<script lang="ts">
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { Languages } from "@lucide/svelte";

  interface Props {
    value: UiLang;
    label: string;
  }

  let { value = $bindable<UiLang>("zh"), label }: Props = $props();

  const STORAGE_KEY = "nojv-system-text-lang";

  onMount(() => {
    if (!browser) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") value = saved;
  });

  function set(next: UiLang) {
    value = next;
    if (browser) localStorage.setItem(STORAGE_KEY, next);
  }
</script>

<div class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
  <span class="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground">
    <Languages class="h-3.5 w-3.5" /> {label}
  </span>
  <button
    type="button"
    class="rounded-full px-3 py-1 text-xs font-medium {value === 'zh'
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground'}"
    onclick={() => set("zh")}
  >
    中文
  </button>
  <button
    type="button"
    class="rounded-full px-3 py-1 text-xs font-medium {value === 'en'
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground'}"
    onclick={() => set("en")}
  >
    English
  </button>
</div>
