<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import CourseJoinCallToAction from "$lib/components/course/JoinCallToAction.svelte";

  let { data } = $props();
</script>

<div class="space-y-6">
  <CourseJoinCallToAction
    courseSlug={data.courseSlug}
    courseTitle={data.courseTitle}
    form={data.form}
    joinTokenKind={data.joinTokenKind}
    joinToken={data.joinToken}
  />
  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
  >
    <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
      {m.navigation_courses()}
    </p>
    <p class="mt-3 text-body-sm leading-7 text-muted-foreground">
      {m.courseJoin_hint()}
    </p>
  </section>
</div>
