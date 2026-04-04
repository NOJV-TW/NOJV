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
    problemIds={data.problemIds}
  />

  <ManageContests
    contests={data.contests}
    courseSlug={data.courseSlug}
    form={data.contestForm}
    problemIds={data.problemIds}
  />
</div>
