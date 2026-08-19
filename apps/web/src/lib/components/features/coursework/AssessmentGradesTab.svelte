<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import MatrixView, {
    type MatrixViewData,
    type MatrixViewLabels,
  } from "$lib/components/features/course/submissions/MatrixView.svelte";
  import ScoreDistributionPanel from "$lib/components/features/results/ScoreDistributionPanel.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";

  interface GradeStats {
    buckets: { label: string; count: number }[];
    submitted: number;
    total: number;
    maxScore: number;
    classAvg: number;
    median: number;
    max: number;
    min: number;
  }

  interface Props {
    matrix: MatrixViewData;
    stats: GradeStats;
    csvDownloadName: string;
    dataSlot: string;
    labels: MatrixViewLabels;
    showRoleFilter?: boolean;
    viewHref?: (userId: string) => string;
    oncellclick?: ((userId: string, problemId: string) => void) | undefined;
  }

  let {
    matrix,
    stats,
    csvDownloadName,
    dataSlot,
    labels,
    showRoleFilter = false,
    viewHref,
    oncellclick,
  }: Props = $props();
</script>

<div class="space-y-5">
  <div
    data-slot="grades-overview"
    class="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"
  >
    <GlassPanel class="h-full p-4 lg:p-5">
      <div class="grid h-full grid-cols-2 content-center gap-4 sm:grid-cols-4">
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.results_submittedLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {stats.submitted}/{stats.total}
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.results_avgLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {stats.classAvg}<span class="text-body-sm text-muted-foreground">
              / {stats.maxScore}</span
            >
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.results_medianLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {stats.median}<span class="text-body-sm text-muted-foreground">
              / {stats.maxScore}</span
            >
          </div>
        </div>
        <div>
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.results_minMaxLabel()}
          </div>
          <div class="mt-1 text-title font-semibold tabular-nums">
            {stats.max} / {stats.min}<span class="text-body-sm text-muted-foreground">
              / {stats.maxScore}</span
            >
          </div>
        </div>
      </div>
    </GlassPanel>
    <ScoreDistributionPanel
      buckets={stats.buckets}
      submitted={stats.submitted}
      heading={m.results_distributionHeading()}
      showHeader={false}
      class="h-full"
    />
  </div>

  <GlassPanel class="min-w-0 p-5">
    <MatrixView
      {matrix}
      {csvDownloadName}
      {dataSlot}
      {labels}
      {showRoleFilter}
      showHint={false}
      {...viewHref ? { viewHref } : {}}
      {...oncellclick ? { oncellclick } : {}}
    />
  </GlassPanel>
</div>
