<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ECharts, EChartsOption } from "echarts";
  import { Skeleton } from "$lib/components/primitives/ui/skeleton";

  interface Props {
    option: EChartsOption;
    class?: string;
    ariaLabel?: string;
  }

  let { option, class: className = "", ariaLabel }: Props = $props();
  let container: HTMLDivElement;
  let chart: ECharts | undefined;
  let observer: ResizeObserver | undefined;
  let ready = $state(false);
  let lastSerialized = "";
  let resizeFrame = 0;

  onMount(() => {
    import("echarts").then((echarts) => {
      chart = echarts.init(container);

      // Only resize when the container box actually changes. An unguarded
      // resize() inside ResizeObserver re-fires while hovering (emphasis/tooltip
      // nudge the layout), redrawing the whole chart — which reads as flicker.
      let lastW = container.clientWidth;
      let lastH = container.clientHeight;
      observer = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => chart?.resize());
      });
      observer.observe(container);
      ready = true;
    });
  });

  onDestroy(() => {
    // onDestroy also runs during SSR teardown, where rAF APIs don't exist.
    if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(resizeFrame);
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

<div class="relative {className}">
  <div
    bind:this={container}
    class="h-full w-full"
    role={ariaLabel ? "img" : undefined}
    aria-label={ariaLabel}
  ></div>
  {#if !ready}
    <div class="absolute inset-0">
      <Skeleton class="h-full w-full" />
    </div>
  {/if}
</div>
