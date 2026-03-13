<script lang="ts">
  import AssessmentListView from "$lib/components/course/AssessmentListView.svelte";
  import ContestListView from "$lib/components/contest/ContestListView.svelte";

  let { data } = $props();
</script>

<div class="space-y-10">
  <AssessmentListView items={data.items} type="exam" />

  {#if data.contests.length > 0}
    <ContestListView contests={data.contests} />
  {/if}
</div>
