<script lang="ts">
  import ProblemWorkspace from "$lib/components/problem/Workspace.svelte";

  let { data } = $props();
</script>

<div
  class="flex h-[calc(100vh-7rem)] overflow-hidden rounded-[2rem] border border-border"
>
  <ProblemWorkspace
    assessment={data.assessmentProp}
    backLink={data.backLink}
    contestSlug={data.contestSlug}
    initialSubmissions={data.submissions}
    problem={data.problem}
  />
</div>
