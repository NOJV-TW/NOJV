<script lang="ts">
  import { untrack } from "svelte";
  import type { SubmissionContext, SubmissionResult } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import { createEditorRunController } from "$lib/components/features/problem/editors/use-editor-run.svelte";
  let {
    problem,
    context,
    onSubmissionDispatched,
    onSubmissionComplete,
  }: {
    problem: ProblemDetail;
    context: SubmissionContext;
    onSubmissionDispatched: (id: string, language: string) => void;
    onSubmissionComplete: (
      id: string,
      result: SubmissionResult,
      language: string,
      source: string,
    ) => void;
  } = $props();
  const controller = createEditorRunController({
    problemId: untrack(() => problem.id),
    initialSamples: [],
    language: () => "python",
    isWorkspaceMode: () => false,
    isSpecialEnv: () => false,
    judgeType: () => "standard",
    judgeConfig: () => ({ type: "standard" }),
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    drafts: () => ({ python: "print(1)" }),
    workspaceDrafts: () => ({}),
    workspaceFiles: () => [],
    context: () => context,
    onSubmissionDispatched: (id, language) => onSubmissionDispatched(id, language),
    onSubmissionComplete: (id, result, language, source) =>
      onSubmissionComplete(id, result, language, source),
  });
  $effect(() => () => controller.markDestroyed());
</script>

<button onclick={() => void controller.submit()}>Submit {problem.id}</button>
