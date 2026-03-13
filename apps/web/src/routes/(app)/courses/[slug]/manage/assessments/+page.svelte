<script lang="ts">
  import ManageAssessments from "$lib/components/manage/Assessments.svelte";
  import ManageContests from "$lib/components/manage/Contests.svelte";

  let { data } = $props();
</script>

<div class="space-y-10">
  <ManageAssessments
    assessments={data.assessments}
    courseSlug={data.courseSlug}
    form={data.form}
    problemSlugs={data.problemSlugs}
  />

  <ManageContests
    contests={data.contests}
    courseSlug={data.courseSlug}
    form={data.contestForm}
    problemSlugs={data.problemSlugs}
  />
</div>
