<script lang="ts">
  import ManageAssessments from "$lib/components/ManageAssessments.svelte";

  let { data } = $props();
</script>

<ManageAssessments
  assessments={data.assessments}
  courseSlug={data.courseSlug}
  problemSlugs={data.problemSlugs}
/>
