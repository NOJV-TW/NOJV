<script lang="ts">
  import { onMount } from "svelte";
  import type { ECharts, EChartsOption } from "echarts";
  import { m } from "$lib/paraglide/messages.js";
  import { Skeleton } from "$lib/components/primitives/ui/skeleton";
  import { loadECharts } from "./echarts-loader";

  interface Props {
    option: EChartsOption;
    class?: string;
    ariaLabel: string;
    summary: string;
  }

  let { option, class: className = "", ariaLabel, summary }: Props = $props();
  const chartId = $props.id();
  let container: HTMLDivElement;
  let chart: ECharts | undefined;
  let observer: ResizeObserver | undefined;
  let ready = $state(false);
  let loadFailed = $state(false);
  let resizeFrame = 0;

  onMount(() => {
    let active = true;
    void loadECharts()
      .then((echarts) => {
        if (!active) return;
        const instance = echarts.init(container);
        chart = instance;

        // Only resize when the container box actually changes. An unguarded
        // resize() inside ResizeObserver re-fires while hovering (emphasis/tooltip
        // nudge the layout), redrawing the whole chart — which reads as flicker.
        let lastW = container.clientWidth;
        let lastH = container.clientHeight;
        const resizeObserver = new ResizeObserver(() => {
          if (!active) return;
          const w = container.clientWidth;
          const h = container.clientHeight;
          if (w === lastW && h === lastH) return;
          lastW = w;
          lastH = h;
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            if (active) instance.resize();
          });
        });
        observer = resizeObserver;
        resizeObserver.observe(container);
        ready = true;
      })
      .catch(() => {
        observer?.disconnect();
        observer = undefined;
        chart?.dispose();
        chart = undefined;
        if (active) loadFailed = true;
      });

    return () => {
      active = false;
      cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      observer = undefined;
      chart?.dispose();
      chart = undefined;
    };
  });

  $effect(() => {
    const snapshot = option;
    if (!ready || !chart) return;
    chart.setOption(snapshot, { lazyUpdate: true, notMerge: true });
  });
</script>

<div class="relative {className}">
  <div
    bind:this={container}
    class="h-full w-full"
    role="img"
    aria-labelledby="{chartId}-label {chartId}-summary"
  ></div>
  <span id="{chartId}-label" class="sr-only">{ariaLabel}</span>
  <span id="{chartId}-summary" class="sr-only">{summary}</span>
  {#if loadFailed}
    <div
      class="absolute inset-0 flex items-center justify-center bg-[color:var(--color-panel)] px-4 text-center text-body-sm text-destructive"
      role="alert"
    >
      {m.chart_loadFailed()}
    </div>
  {:else if !ready}
    <div class="absolute inset-0">
      <Skeleton class="h-full w-full" />
    </div>
  {/if}
</div>
