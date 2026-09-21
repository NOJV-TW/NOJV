<script lang="ts">
  import { createSubmissionHistory } from "$lib/services/submission-history.svelte";
  let { query, initial }: { query: string; initial: { id: string; status: string }[] } =
    $props();
  const history = createSubmissionHistory(
    () => query,
    () => initial,
  );
</script>

<div data-page>{history.page}</div>
<div data-pages>{history.totalPages}</div>
<div data-total>{history.totalCount}</div>
<div data-new>{history.newCount}</div>
<div data-loading>{String(history.loading)}</div>
<div data-failed>{String(history.failed)}</div>
{#each history.items as row (row.id)}<div data-row={row.id}>{row.status}</div>{/each}
<button type="button" onclick={() => history.goToPage(history.page + 1)}>Next</button>
<button type="button" onclick={() => history.goToPage(4)}>Fourth</button>
<button type="button" onclick={history.showLatest}>Latest</button>

<button type="button" onclick={history.retry}>Retry</button>
