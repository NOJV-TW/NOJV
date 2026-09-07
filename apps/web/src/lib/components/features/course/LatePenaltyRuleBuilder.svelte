<script lang="ts">
  import type { LatePenaltyRule } from "@nojv/core";
  type LatePenaltyOptionKey = "none" | LatePenaltyRule["type"];

  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName, cn } from "$lib/utils/css.js";

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
</script>

<div data-slot="late-penalty-rule-builder" class={cn("flex items-center gap-2", className)}>
  <select
    id={name}
    {name}
    {disabled}
    aria-label={m.assignmentCreate_latePenaltyLabel()}
    value={selectedKey}
    onchange={(event) => handleSelect(event.currentTarget.value as LatePenaltyOptionKey)}
    class={cn(inputClassName, "min-w-0 flex-1")}
  >
    {#each options as option (option.key)}<option value={option.key}>{option.title}</option
      >{/each}
  </select>
  {#if value}
    <div class="flex shrink-0 items-center gap-1.5">
      <input
        {disabled}
        type="number"
        min="0"
        max="100"
        value={value.type === "flat_late_penalty" ? value.penaltyPct : value.perDayPct}
        oninput={(event) =>
          value?.type === "flat_late_penalty"
            ? updateFlatPct(event.currentTarget.value)
            : updateDailyPct(event.currentTarget.value)}
        class={cn(inputClassName, "w-20 tabular-nums")}
        aria-label={value.type === "flat_late_penalty"
          ? m.latePenalty_flatDeductLabel()
          : m.latePenalty_dailyPerDayLabel()}
      />
      <span class="mt-2 text-sm text-muted-foreground" aria-hidden="true">%</span>
    </div>
  {/if}
</div>
