<script lang="ts">
  import type { EChartsOption } from "echarts";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";

  interface Props {
    initialOption: EChartsOption;
    ariaLabel: string;
    summary: string;
  }

  let { initialOption, ariaLabel, summary }: Props = $props();

  function getInitialOption(): EChartsOption {
    return initialOption;
  }

  let option = $state(getInitialOption());

  export function setOption(nextOption: EChartsOption): void {
    option = nextOption;
  }
</script>

<EChart {option} {ariaLabel} {summary} class="h-64" />
