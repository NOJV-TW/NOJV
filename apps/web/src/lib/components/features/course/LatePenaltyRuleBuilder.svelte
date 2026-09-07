<script lang="ts">
  import type { LatePenaltyRule } from "@nojv/core";
  type LatePenaltyOptionKey = "none" | LatePenaltyRule["type"];

  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    value: LatePenaltyRule | null;
    onChange: (value: LatePenaltyRule | null) => void;
    class?: string;
    name?: string;
    disabled?: boolean;
  }

  let {
    value,
    onChange,
    class: className,
    name = "late-penalty-rule",
    disabled = false,
  }: Props = $props();

  const selectedKey = $derived<LatePenaltyOptionKey>(value === null ? "none" : value.type);

  const FLAT_DEFAULT_PCT = 20;
  const DAILY_DEFAULT_PCT = 10;

  function handleSelect(key: LatePenaltyOptionKey) {
    if (key === "none") {
      onChange(null);
      return;
    }
    if (key === "flat_late_penalty") {
      onChange({
        type: "flat_late_penalty",
        penaltyPct: value?.type === "flat_late_penalty" ? value.penaltyPct : FLAT_DEFAULT_PCT,
      });
      return;
    }
    if (key === "daily_late_penalty") {
      onChange({
        type: "daily_late_penalty",
        perDayPct: value?.type === "daily_late_penalty" ? value.perDayPct : DAILY_DEFAULT_PCT,
      });
      return;
    }
  }

  function updateFlatPct(raw: string) {
    if (value?.type !== "flat_late_penalty") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange({ ...value, penaltyPct: Math.max(0, Math.min(100, parsed)) });
  }

  function updateDailyPct(raw: string) {
    if (value?.type !== "daily_late_penalty") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange({ ...value, perDayPct: Math.max(0, Math.min(100, parsed)) });
  }

  const options = $derived([
    {
      key: "none" as const,
      title: m.latePenalty_noneTitle(),
    },
    {
      key: "flat_late_penalty" as const,
      title: m.latePenalty_flatTitle(),
    },
    {
      key: "daily_late_penalty" as const,
      title: m.latePenalty_dailyTitle(),
    },
  ]);

  const paramInputClass =
    "w-[84px] rounded-sm border border-border bg-background px-2 py-1 text-right font-mono text-body-sm font-semibold tabular-nums focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
</script>

<div data-slot="late-penalty-rule-builder" class={cn("space-y-3", className)}>
  <select
    id={name}
    {name}
    {disabled}
    aria-label={m.assignmentCreate_latePenaltyLabel()}
    value={selectedKey}
    onchange={(event) => handleSelect(event.currentTarget.value as LatePenaltyOptionKey)}
    class="w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
  >
    {#each options as option (option.key)}
      <option value={option.key}>{option.title}</option>
    {/each}
  </select>

  {#if selectedKey === "flat_late_penalty" && value?.type === "flat_late_penalty"}
    <div
      class="flex flex-wrap items-center gap-3 rounded-sm bg-[color:var(--color-panel-strong)] px-3.5 py-3"
    >
      <span class="text-caption text-muted-foreground">
        {m.latePenalty_flatDeductLabel()}
      </span>
      <input
        {disabled}
        type="number"
        min="0"
        max="100"
        value={value.penaltyPct}
        oninput={(e) => updateFlatPct(e.currentTarget.value)}
        class={paramInputClass}
        aria-label={m.latePenalty_flatDeductLabel()}
      />
      <span class="text-caption">%</span>
    </div>
  {:else if selectedKey === "daily_late_penalty" && value?.type === "daily_late_penalty"}
    <div
      class="flex flex-wrap items-center gap-3 rounded-sm bg-[color:var(--color-panel-strong)] px-3.5 py-3"
    >
      <span class="text-caption text-muted-foreground">
        {m.latePenalty_dailyPerDayLabel()}
      </span>
      <input
        {disabled}
        type="number"
        min="0"
        max="100"
        value={value.perDayPct}
        oninput={(e) => updateDailyPct(e.currentTarget.value)}
        class={paramInputClass}
        aria-label={m.latePenalty_dailyPerDayLabel()}
      />
      <span class="text-caption">%</span>
    </div>
  {/if}
  {#if value?.type === "daily_late_penalty"}
    <p class="text-caption text-muted-foreground">{m.latePenalty_dailyHint()}</p>
  {/if}
</div>
