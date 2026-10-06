<script lang="ts">
  import type { Language } from "@nojv/core";

  let {
    language,
    onAvailableChange,
  }: { language: Language; onAvailableChange: (available: Language[]) => void } = $props();

  $effect(() => onAvailableChange([language]));
</script>
