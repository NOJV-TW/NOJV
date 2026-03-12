<script lang="ts">
  import ManageProblems from "$lib/components/manage/Problems.svelte";

  let { data } = $props();
</script>

<ManageProblems
  courseSlug={data.courseSlug}
  courseTitle={data.courseTitle}
  form={data.form}
  problems={data.problems}
/>
