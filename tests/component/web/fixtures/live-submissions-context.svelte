<script lang="ts">
  import { untrack } from "svelte";
  import LiveSubmissionsFeed from "$lib/components/features/coursework/LiveSubmissionsFeed.svelte";
  import type { ComponentProps } from "svelte";
  type FeedProps = ComponentProps<typeof LiveSubmissionsFeed>;
  let { initialRows, initialUrl }: { initialRows: FeedProps["rows"]; initialUrl: string } =
    $props();
  let rows = $state(untrack(() => initialRows));
  let refreshUrl = $state(untrack(() => initialUrl));
  export function changeContext(url: string, next: FeedProps["rows"]) {
    refreshUrl = url;
    rows = next;
  }
</script>

<LiveSubmissionsFeed {rows} {refreshUrl} />
