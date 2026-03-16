<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { EChartsOption } from "echarts";

  interface Props {
    option: EChartsOption;
    class?: string;
  }

  let { option, class: className = "" }: Props = $props();
  let container: HTMLDivElement;
  let chart: any;
  let observer: ResizeObserver | undefined;

  onMount(() => {
    import("echarts").then((echarts) => {
      chart = echarts.init(container);
      chart.setOption(option);

      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(container);
    });
  });

  onDestroy(() => {
    observer?.disconnect();
    chart?.dispose();
  });

  $effect(() => {
    chart?.setOption(option);
  });
</script>

<div bind:this={container} class={className}></div>
