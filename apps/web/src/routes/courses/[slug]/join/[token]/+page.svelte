<script lang="ts">
  import { t } from "svelte-i18n";
  import CourseJoinCallToAction from "$lib/components/course/JoinCallToAction.svelte";

  let { data } = $props();
</script>

<div class="space-y-6">
  <CourseJoinCallToAction
    courseSlug={data.courseSlug}
    courseTitle={data.courseTitle}
    joinMethod={data.joinMethod}
    joinToken={data.joinToken}
  />
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-6 py-6"
  >
    <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
      {$t("navigation.courses")}
    </p>
    <p class="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
      {$t("courseJoin.hint")}
    </p>
  </section>
</div>
