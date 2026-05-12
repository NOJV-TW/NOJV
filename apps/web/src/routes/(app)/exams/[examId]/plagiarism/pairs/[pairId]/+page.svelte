<script lang="ts">
  import PlagiarismPairDiff from "$lib/components/plagiarism/PlagiarismPairDiff.svelte";

  let { data } = $props();
</script>

<PlagiarismPairDiff {data} />
