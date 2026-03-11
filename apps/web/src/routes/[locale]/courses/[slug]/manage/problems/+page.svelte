<script lang="ts">
  import ManageProblems from "$lib/components/ManageProblems.svelte";

  let { data } = $props();
</script>

<ManageProblems
  courseSlug={data.courseSlug}
  courseTitle={data.courseTitle}
  problems={data.problems}
/>
