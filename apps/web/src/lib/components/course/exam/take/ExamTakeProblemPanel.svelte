<script lang="ts">
  import { Flag } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import DifficultyTick from "$lib/components/coursework/DifficultyTick.svelte";

  interface Props {
    letter: string;
    title: string;
    difficulty: "easy" | "medium" | "hard";
    points: number;
    flagged: boolean;
    onToggleFlag: () => void;
  }

  let {
    letter,
    title,
    difficulty,
    points,
    flagged,
    onToggleFlag
  }: Props = $props();

  function difficultyLevel(
    d: "easy" | "medium" | "hard"
  ): "Easy" | "Medium" | "Hard" {
    if (d === "easy") return "Easy";
    if (d === "hard") return "Hard";
    return "Medium";
  }
</script>

<section class="overflow-y-auto border-r border-border-subtle p-7">
  <div class="mb-3 flex items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <span class="font-mono text-title text-muted-foreground">{letter}.</span>
      <h2 class="font-display text-title-lg font-semibold">{title}</h2>
    </div>
    <button
      type="button"
      onclick={onToggleFlag}
      class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 font-mono text-caption uppercase tracking-wider transition-colors hover:border-border"
      style:color={flagged ? "var(--primary)" : undefined}
      style:border-color={flagged ? "var(--primary)" : undefined}
    >
      <Flag class="size-3" /> {m.examTake_flagButton()}
    </button>
  </div>
  <div class="flex items-center gap-4 text-caption text-muted-foreground">
    <DifficultyTick level={difficultyLevel(difficulty)} />
    <span>{m.examTake_maxPointsLabel()} <span class="font-mono">{points}</span></span>
  </div>

  <!--
    TODO(NOJV): wire to real problem statement renderer. The exam
    take-view currently only knows about title/letter/difficulty/points
    because `ExamDetailPageData` doesn't include the body markdown. The
    fastest path is to load the problem detail in the +page.server.ts
    for the active problem id, or fall back to navigating to
    `/exams/[id]/problems/[problemId]` for the full workspace.
  -->
  <div class="mt-6 space-y-4 text-body">
    <h3 class="font-display text-title font-semibold">{m.examTake_statementHeading()}</h3>
    <p class="text-muted-foreground">
      {m.examTake_statementPlaceholder()}
    </p>
  </div>
</section>
