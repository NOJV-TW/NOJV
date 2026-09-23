<script lang="ts">
  import { untrack } from "svelte";
  import type { ProblemSubmissionEntry } from "$lib/types";
  import SubmissionHistoryPanel from "$lib/components/features/problem/left-panel/SubmissionHistoryPanel.svelte";
  let { initial }: { initial: ProblemSubmissionEntry[] } = $props();
  let submissions = $state(untrack(() => initial));
  export function refresh(rows: ProblemSubmissionEntry[]) {
    submissions = rows;
  }
</script>

<SubmissionHistoryPanel bind:submissions viewingId="submission_1" />
