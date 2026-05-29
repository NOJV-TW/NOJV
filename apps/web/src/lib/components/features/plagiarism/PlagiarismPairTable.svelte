<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Button, LinkButton } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css.js";
  import type { PlagiarismReportPair } from "./AssignmentPlagiarismReport.svelte";

  interface Props {
    pairs: PlagiarismReportPair[];
    variant: "high" | "medium";
    flaggedKeys: Set<string>;
    expandedPairKeys: Set<string>;
    pairKey: (p: PlagiarismReportPair) => string;
    pairKeyOf: (p: PlagiarismReportPair) => string;
    studentName: (userId: string) => string;
    studentHandle: (userId: string) => string;
    problemLetter: (problemId: string) => string;
    problemTitle: (problemId: string) => string;
    diffHrefFor: (p: PlagiarismReportPair) => string | null;
    onTogglePair: (p: PlagiarismReportPair) => void;
  }

  let {
    pairs,
    variant,
    flaggedKeys,
    expandedPairKeys,
    pairKey,
    pairKeyOf,
    studentName,
    studentHandle,
    problemLetter,
    problemTitle,
    diffHrefFor,
    onTogglePair
  }: Props = $props();

  let isHigh = $derived(variant === "high");
</script>

<div class="space-y-3">
  {#each pairs as pair, i (pairKey(pair))}
    {@const key = pairKey(pair)}
    {@const expanded = isHigh && (i === 0 || expandedPairKeys.has(key))}
    {@const flagged = flaggedKeys.has(pairKeyOf(pair))}
    {@const diffHref = diffHrefFor(pair)}
    <div
      class={cn(
        "rounded-md px-6 py-5",
        isHigh && "border border-destructive/40 bg-destructive/[0.04]",
        !isHigh && "border border-warning/30 bg-warning/[0.04]",
        flagged && "opacity-50"
      )}
    >
      <div
        class={cn(
          "grid items-center gap-4",
          isHigh
            ? "grid-cols-[auto_1fr_auto_auto_auto]"
            : "grid-cols-[auto_1fr_auto_auto]"
        )}
      >
        <div
          class={cn(
            "min-w-[100px] text-display font-medium leading-[0.9] tracking-[-0.03em]",
            isHigh ? "text-destructive" : "text-warning"
          )}
        >
          {pair.similarity}<span
            class="align-[0.4em] text-[0.5em] font-normal text-muted-foreground">%</span
          >
        </div>
        <div class="flex items-center gap-3 text-body">
          <div>
            <div class="font-semibold">{studentName(pair.userId1)}</div>
            <div class="mt-0.5 font-mono text-caption text-muted-foreground">
              {studentHandle(pair.userId1)}
            </div>
          </div>
          <span class="text-body-lg text-muted-foreground">↔</span>
          <div>
            <div class="font-semibold">{studentName(pair.userId2)}</div>
            <div class="mt-0.5 font-mono text-caption text-muted-foreground">
              {studentHandle(pair.userId2)}
            </div>
          </div>
          {#if flagged}
            <span
              class="ml-2 inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-warning"
            >
              {m.plagiarism_flaggedBadge()}
            </span>
          {/if}
        </div>
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-caption font-semibold text-muted-foreground"
        >
          {problemLetter(pair.problemId)} · {problemTitle(pair.problemId)}
        </span>
        {#if diffHref}
          <LinkButton href={diffHref} variant="outline" size="sm">
            {m.plagiarism_openDiff()}
          </LinkButton>
        {/if}
        {#if isHigh}
          <Button
            variant={i === 0 ? "default" : "outline"}
            size="sm"
            onclick={() => onTogglePair(pair)}
          >
            {expanded
              ? m.assignmentDetail_plagCollapse()
              : m.assignmentDetail_plagExpand()}
          </Button>
        {/if}
      </div>

      {#if isHigh && expanded}
        <div
          class="mt-4 grid grid-cols-2 gap-4 border-t border-destructive/20 pt-4 text-caption text-muted-foreground"
        >
          <div>
            <strong class="mb-1 block font-semibold text-foreground">
              {m.assignmentDetail_plagLongestFragment()}
            </strong>
            {m.assignmentDetail_plagTokens({ count: pair.longest })}
          </div>
          <div>
            <strong class="mb-1 block font-semibold text-foreground">
              {m.assignmentDetail_plagTotalOverlap()}
            </strong>
            {m.assignmentDetail_plagTokens({ count: pair.overlap })}
          </div>
        </div>

        <div class="mt-4 overflow-hidden rounded-md bg-[#1f1916] text-[#f5ede4]">
          <div
            class="grid grid-cols-2 border-b border-[rgba(245,237,228,0.1)] bg-[rgba(245,237,228,0.05)] px-4 py-2 font-mono text-caption"
          >
            <span>{studentHandle(pair.userId1) || studentName(pair.userId1)} / source</span>
            <span>{studentHandle(pair.userId2) || studentName(pair.userId2)} / source</span>
          </div>
          <div class="grid grid-cols-2 font-mono text-caption leading-[1.5]">
            <div class="border-r border-[rgba(245,237,228,0.08)] px-4 py-3 opacity-60">
              {m.assignmentDetail_plagRetrieving()}
            </div>
            <div class="px-4 py-3 opacity-60">
              {m.assignmentDetail_plagRetrieving()}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>
