<script lang="ts">
  import { superForm } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";

  let { data } = $props();

  const role = (data.user as Record<string, unknown> | null)?.platformRole;
  const canCreate = role === "admin" || role === "teacher";

  const { form, errors, submitting, message: formMessage, enhance } = superForm(data.form, {
    invalidateAll: true
  });
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">{m.navigation_courses()}</h2>

  {#if data.courses.length === 0}
    <p class="text-sm text-[color:var(--color-muted)]">{m.courseDetail_empty()}</p>
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
              {m.courseDetail_course()}
            </p>
            <h3 class="mt-2 text-2xl font-semibold">{course.title}</h3>
          </div>
          <span
            class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
          >
            {m.courseDetail_rbacEnabled()}
          </span>
        </div>
        <dl class="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-sm text-[color:var(--color-muted)]">{m.common_members()}</dt>
            <dd class="mt-1 text-lg font-semibold">{course.memberCount}</dd>
          </div>
          <div>
            <dt class="text-sm text-[color:var(--color-muted)]">{m.common_assessments()}</dt>
            <dd class="mt-1 text-lg font-semibold">{course.assessmentCount}</dd>
          </div>
        </dl>
      </a>
    {/each}
  </section>

  {#if canCreate}
    <section
      class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
    >
      <h3 class="text-2xl font-semibold">{m.admin_createCourse()}</h3>
      <p class="mt-1 text-sm text-[color:var(--color-muted)]">
        {m.admin_createCourseSubtitle()}
      </p>
      <form
        class="mt-4 grid gap-3"
        method="POST"
        action="?/create"
        use:enhance
      >
        <div>
          <label class="text-sm font-medium" for="course-title">{m.admin_title()}</label>
          <input
            class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
            id="course-title"
            name="title"
            bind:value={$form.title}
            required
          />
          {#if $errors.title}<span class="text-sm text-red-700">{$errors.title}</span>{/if}
        </div>
        <div>
          <label class="text-sm font-medium" for="course-slug">{m.admin_slug()}</label>
          <input
            class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
            id="course-slug"
            name="slug"
            bind:value={$form.slug}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            placeholder="my-course"
            required
          />
          {#if $errors.slug}<span class="text-sm text-red-700">{$errors.slug}</span>{/if}
        </div>
        <div>
          <label class="text-sm font-medium" for="course-description">{m.admin_description()}</label>
          <textarea
            class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
            id="course-description"
            name="description"
            bind:value={$form.description}
            rows="3"
            required
          ></textarea>
          {#if $errors.description}<span class="text-sm text-red-700">{$errors.description}</span>{/if}
        </div>
        <div>
          <label class="text-sm font-medium" for="course-locale">{m.admin_locale()}</label>
          <select
            class="mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm"
            id="course-locale"
            name="locale"
            bind:value={$form.locale}
          >
            <option value="zh-TW">zh-TW</option>
            <option value="en">en</option>
          </select>
        </div>
        <button
          class="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={$submitting}
          type="submit"
        >
          {$submitting ? m.common_creating() : m.admin_createCourseButton()}
        </button>
      </form>
      {#if $formMessage}
        <p class="mt-4 text-sm text-emerald-700">{$formMessage}</p>
      {/if}
    </section>
  {/if}
</div>
