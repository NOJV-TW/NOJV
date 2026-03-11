<script lang="ts">
  import ProblemWorkspace from "$lib/components/problem/Workspace.svelte";

  let { data } = $props();
</script>

<div
  class="flex h-[calc(100vh-7rem)] overflow-hidden rounded-2xl border border-[color:var(--color-border)]"
>
  <ProblemWorkspace
    assessment={data.assessmentProp}
    backLink={data.backLink}
    problem={data.problem}
  />
</div>
