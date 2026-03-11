<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { t } from "svelte-i18n";

  import type { CourseMemberRecord } from "$lib/server/queries";

  interface Props {
    courseSlug: string;
    courseTitle: string;
    members: CourseMemberRecord[];
  }

  let { courseSlug, courseTitle, members }: Props = $props();

  let enrollName = $state("");
  let enrollEmail = $state("");
  let enrollHandle = $state("");
  let enrollRole = $state<"student" | "ta" | "teacher">("student");
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let isEnrolling = $state(false);

  async function handleManualEnrollment() {
    isEnrolling = true;
    error = null;
    status = null;

    try {
      const payload = {
        displayName: enrollName,
        email: enrollEmail,
        handle: enrollHandle,
        role: enrollRole
      };

      const formData = new FormData();
      formData.set("data", JSON.stringify(payload));

      const response = await fetch("?/enroll", { method: "POST", body: formData });
      const result = await response.json();

      if (result.type === "failure") {
        throw new Error(result.data?.error ?? "Manual enrollment failed.");
      }

      status = `Enrolled ${enrollName} into ${courseTitle}.`;
      enrollName = "";
      enrollEmail = "";
      enrollHandle = "";
      void invalidateAll();
    } catch (issue) {
      error = issue instanceof Error ? issue.message : "Manual enrollment failed.";
    } finally {
      isEnrolling = false;
    }
  }
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">{$t("courseManage.members")}</h3>
      <span
        class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
      >
        {members.length}
      </span>
    </div>
    <div class="mt-5 space-y-3">
      {#each members as member (member.userId)}
        <article
          class="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <div>
            <p class="text-lg font-semibold">{member.displayName}</p>
            <p class="mt-1 text-sm text-[color:var(--color-muted)]">
              {member.handle ?? "\u2014"} &middot; {member.email}
            </p>
          </div>
          <div class="text-right">
            <p
              class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]"
            >
              {member.courseRole}
            </p>
            <p class="mt-1 text-sm text-[color:var(--color-muted)]">
              via {member.joinedVia.replaceAll("_", " ")}
            </p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <h3 class="text-2xl font-semibold">{$t("courseManage.enrollMember")}</h3>
    <form
      class="mt-4 grid gap-3"
      onsubmit={(e) => {
        e.preventDefault();
        void handleManualEnrollment();
      }}
    >
      <input
        class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
        bind:value={enrollName}
        placeholder="Display name"
        required
      />
      <div class="grid gap-3 md:grid-cols-2">
        <input
          class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
          bind:value={enrollEmail}
          placeholder="Email"
          required
          type="email"
        />
        <input
          class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
          bind:value={enrollHandle}
          placeholder="Handle"
          required
        />
      </div>
      <select class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm" bind:value={enrollRole}>
        <option value="student">student</option>
        <option value="ta">ta</option>
        <option value="teacher">teacher</option>
      </select>
      <button
        class="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={isEnrolling}
        type="submit"
      >
        {isEnrolling ? $t("common.enrolling") : $t("courseManage.enrollMember")}
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
