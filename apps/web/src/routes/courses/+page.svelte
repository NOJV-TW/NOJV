<script lang="ts">
  import { t } from "svelte-i18n";

  let { data } = $props();
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">{$t("navigation.courses")}</h2>

  {#if data.courses.length === 0}
    <p class="text-sm text-[color:var(--color-muted)]">{$t("courseDetail.empty")}</p>
  {/if}

  <section class="grid gap-4 lg:grid-cols-2">
    {#each data.courses as course (course.slug)}
      <a
        class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-6 py-6 transition hover:-translate-y-0.5"
        href="/courses/{course.slug}"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
              {$t("courseDetail.course")}
            </p>
            <h3 class="mt-2 text-2xl font-semibold">{course.title}</h3>
          </div>
          <span
            class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
          >
            {$t("courseDetail.rbacEnabled")}
          </span>
        </div>
        <dl class="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-sm text-[color:var(--color-muted)]">{$t("common.members")}</dt>
            <dd class="mt-1 text-lg font-semibold">{course.memberCount}</dd>
          </div>
          <div>
            <dt class="text-sm text-[color:var(--color-muted)]">{$t("common.assessments")}</dt>
            <dd class="mt-1 text-lg font-semibold">{course.assessmentCount}</dd>
          </div>
        </dl>
      </a>
    {/each}
  </section>
</div>
