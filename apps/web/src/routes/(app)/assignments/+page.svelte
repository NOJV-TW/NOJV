<script lang="ts">
  import AssessmentListView from "$lib/components/course/AssessmentListView.svelte";

  let { data } = $props();
</script>

<AssessmentListView items={data.items} type="assignment" />
