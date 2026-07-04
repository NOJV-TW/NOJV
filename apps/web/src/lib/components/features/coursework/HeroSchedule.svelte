<script lang="ts">
  import { formatDateTimeCompact } from "$lib/utils/datetime";

  interface Props {
    startIso: string;
    endIso: string;
    startLabel: string;
    endLabel: string;
    accent?: string;
  }

  let { startIso, endIso, startLabel, endLabel, accent = "var(--primary)" }: Props = $props();
</script>

<div
  class="flex flex-col rounded-xl border border-border-subtle bg-[color:var(--color-panel)]/40 px-5 py-5 backdrop-blur-sm"
>
  <div class="flex gap-3">
    <div class="flex flex-col items-center self-stretch" aria-hidden="true">
      <span class="mt-1 size-2.5 shrink-0 rounded-full" style="background: {accent};"></span>
      <span
        class="my-1.5 w-px flex-1"
        style="background: color-mix(in oklab, {accent} 45%, transparent);"
      ></span>
    </div>
    <div class="pb-9">
      <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
        {startLabel}
      </div>
      <div class="mt-0.5 font-mono text-body-sm tabular-nums text-foreground">
        {formatDateTimeCompact(startIso)}
      </div>
    </div>
  </div>
  <div class="flex gap-3">
    <span
      class="mt-1 size-2.5 shrink-0 rounded-full border-2"
      style="border-color: {accent};"
      aria-hidden="true"
    ></span>
    <div>
      <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
        {endLabel}
      </div>
      <div class="mt-0.5 font-mono text-body-sm tabular-nums text-foreground">
        {formatDateTimeCompact(endIso)}
      </div>
    </div>
  </div>
</div>
