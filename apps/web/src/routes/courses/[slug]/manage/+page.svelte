<script lang="ts">
  let { data } = $props();
  let course = $derived(data.courseData.course);
  let problems = $derived(data.courseData.problems);
</script>

<section
  class="rounded-[2rem] border border-[color:var(--color-border)] bg-gradient-to-br from-white/90 to-stone-50/80 px-6 py-8"
>
  <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
    Manage / {course.slug}
  </p>
  <h2 class="mt-2 font-[family-name:var(--font-display)] text-3xl">{course.title}</h2>
  <p class="mt-4 text-[color:var(--color-muted)]">{course.description}</p>
  <div class="mt-6 grid gap-4 sm:grid-cols-3">
    <div class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
      <p class="text-sm text-[color:var(--color-muted)]">Members</p>
      <p class="mt-2 text-2xl font-semibold">{course.members.length}</p>
    </div>
    <div class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
      <p class="text-sm text-[color:var(--color-muted)]">Assessments</p>
      <p class="mt-2 text-2xl font-semibold">{course.assessments.length}</p>
    </div>
    <div class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
      <p class="text-sm text-[color:var(--color-muted)]">Problems</p>
      <p class="mt-2 text-2xl font-semibold">{problems.length}</p>
    </div>
  </div>
</section>
