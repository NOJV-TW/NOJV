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
  let ready = $state(false);
  // Dedup: $derived option objects are recreated on every reactive tick
  // (a new array literal counts as a change). Without an equality check,
  // echarts re-renders the canvas on every keystroke / hover, which the
  // tooltip layer manifests as flicker.
  let lastSerialized = "";

  onMount(() => {
    import("echarts").then((echarts) => {
      chart = echarts.init(container);
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(container);
      ready = true;
    });
  });

  onDestroy(() => {
    observer?.disconnect();
    chart?.dispose();
  });

  $effect(() => {
    if (!ready) return;
    const serialized = JSON.stringify(option);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    chart?.setOption(option, { lazyUpdate: true });
  });
</script>

<div bind:this={container} class={className}></div>
