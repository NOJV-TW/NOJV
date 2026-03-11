<script lang="ts">
  import ManageAssessments from "$lib/components/manage/Assessments.svelte";

  let { data } = $props();
</script>

<ManageAssessments
  assessments={data.assessments}
  courseSlug={data.courseSlug}
  problemSlugs={data.problemSlugs}
/>
