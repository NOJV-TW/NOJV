<script lang="ts">
  import ExamTopStrip from "$lib/components/problem/ExamTopStrip.svelte";
  import ProblemSolveView from "$lib/components/problem/ProblemSolveView.svelte";

  let { data } = $props();
</script>

<div class="flex min-h-screen flex-col">
  <ExamTopStrip context={data.examContext} />
  <div class="flex-1">
    <ProblemSolveView
      mode="exam"
      problem={data.problem}
      submissions={data.submissions}
      siblingProblems={data.siblingProblems}
      examContext={data.examContext}
    />
  </div>
</div>
