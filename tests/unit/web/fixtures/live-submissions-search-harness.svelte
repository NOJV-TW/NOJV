<script lang="ts">
  import type { ComponentProps } from "svelte";
  import LiveSubmissionsFeed from "$lib/components/features/coursework/LiveSubmissionsFeed.svelte";
  let {
    rows,
    refreshUrl,
  }: {
    rows: ComponentProps<typeof LiveSubmissionsFeed>["rows"];
    refreshUrl: string;
  } = $props();
  let search = $state("");
  export function type(value: string) {
    search = value;
  }
</script>

<LiveSubmissionsFeed {rows} {refreshUrl} bind:search />
