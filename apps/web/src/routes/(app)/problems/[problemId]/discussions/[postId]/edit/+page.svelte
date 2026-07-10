<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PostForm from "$lib/components/features/posts/PostForm.svelte";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";

  let { data } = $props();

  const basePath = $derived(
    `/problems/${data.problem.id}/${data.type === "editorial" ? "editorials" : "discussions"}`,
  );
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <h1 class="text-title-lg">{m.posts_editPostTitle()}</h1>
      <p>
        <a href={basePath} class="text-primary hover:underline">
          ← {formatProblemDisplayName(data.problem)}
        </a>
      </p>
    {/snippet}

    <PostForm type={data.type} problemId={data.problem.id} {basePath} post={data.post} />
  </Section>
</PageContainer>
