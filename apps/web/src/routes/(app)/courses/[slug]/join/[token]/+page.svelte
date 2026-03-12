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
    joinMethod={data.joinMethod}
    joinToken={data.joinToken}
  />
  <section
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm"
  >
    <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
      {m.navigation_courses()}
    </p>
    <p class="mt-3 text-sm leading-7 text-muted-foreground">
      {m.courseJoin_hint()}
    </p>
  </section>
</div>
