<script lang="ts">
  import AssessmentListView from "$lib/components/AssessmentListView.svelte";

  let { data } = $props();
</script>

<AssessmentListView items={data.items} type="exam" />
