<script lang="ts">
  import { untrack } from "svelte";
  import type { testJudgeDomain } from "@nojv/application";
  import JudgeProgramTestStatus from "$lib/components/features/problem/tabs/judge/JudgeProgramTestStatus.svelte";

  let { initial }: { initial: testJudgeDomain.JudgeProgramStatus } = $props();
  let status = $state(untrack(() => initial));
  export function setStatus(next: testJudgeDomain.JudgeProgramStatus) {
    status = next;
  }
</script>

<JudgeProgramTestStatus
  {status}
  testJudgeDisabled={false}
  checksSamples
  hasUnsavedChanges={false}
/>
