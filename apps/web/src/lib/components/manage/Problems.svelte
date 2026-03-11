<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { t } from "svelte-i18n";

  import type { CourseProblemCatalogEntry } from "$lib/server/queries";

  interface Props {
    courseSlug: string;
    courseTitle: string;
    problems: CourseProblemCatalogEntry[];
  }

  let { courseSlug, courseTitle, problems }: Props = $props();

  let problemSlug = $state("");
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let isAttaching = $state(false);

  async function handleAttachProblem() {
    isAttaching = true;
    error = null;
    status = null;

    try {
      const payload = { problemSlug };

      const formData = new FormData();
      formData.set("data", JSON.stringify(payload));

      const response = await fetch("?/attach", { method: "POST", body: formData });
      const result = await response.json();

      if (result.type === "failure") {
        throw new Error(result.data?.error ?? "Problem attachment failed.");
      }

      status = `Attached ${problemSlug} to ${courseTitle}.`;
      problemSlug = "";
      void invalidateAll();
    } catch (issue) {
      error = issue instanceof Error ? issue.message : "Problem attachment failed.";
    } finally {
      isAttaching = false;
    }
  }
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">{$t("courseManage.courseProblems")}</h3>
      <span
        class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
      >
        {problems.length}
      </span>
    </div>
    <div class="mt-5 grid gap-3">
      {#each problems as problem (problem.slug)}
        <article
          class="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <div>
            <p class="text-lg font-semibold">{problem.title}</p>
            <p class="mt-2 text-sm text-[color:var(--color-muted)]">
              {problem.summary}
            </p>
          </div>
          <div class="text-right">
            <span
              class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
            >
              {problem.visibility}
            </span>
            <p class="mt-2 text-sm text-[color:var(--color-muted)]">
              by {problem.authorHandle}
            </p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <h3 class="text-2xl font-semibold">{$t("courseManage.attachProblem")}</h3>
    <form
      class="mt-4 grid gap-3"
      onsubmit={(e) => {
        e.preventDefault();
        void handleAttachProblem();
      }}
    >
      <input
        class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
        bind:value={problemSlug}
        pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
        placeholder="problem-slug"
        required
      />
      <button
        class="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={isAttaching}
        type="submit"
      >
        {isAttaching ? $t("common.attaching") : $t("courseManage.attachProblem")}
      </button>
    </form>
    {#if status}
      <p class="mt-4 text-sm text-emerald-700">{status}</p>
    {/if}
    {#if error}
      <p class="mt-4 text-sm text-red-700">{error}</p>
    {/if}
  </section>
</div>
