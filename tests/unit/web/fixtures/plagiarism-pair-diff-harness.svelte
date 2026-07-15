<script lang="ts">
  import PlagiarismPairDiff from "$lib/components/features/plagiarism/PlagiarismPairDiff.svelte";
  import type { PlagiarismPairDiffData } from "$lib/types/plagiarism-pair";

  interface Props {
    initialData: PlagiarismPairDiffData;
  }

  let { initialData }: Props = $props();

  function getInitialData(): PlagiarismPairDiffData {
    return initialData;
  }

  let data = $state(getInitialData());

  export function setData(nextData: PlagiarismPairDiffData): void {
    data = nextData;
  }
</script>

<PlagiarismPairDiff {data} />
