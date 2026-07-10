<script lang="ts">
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PostArticle from "$lib/components/features/posts/PostArticle.svelte";
  import CommentSection from "$lib/components/features/posts/CommentSection.svelte";

  let { data } = $props();

  const basePath = $derived(
    `/problems/${data.problem.id}/${data.type === "editorial" ? "editorials" : "discussions"}`,
  );
</script>

<PageContainer>
  <Section>
    <PostArticle
      post={data.post}
      {basePath}
      viewerId={data.actor.userId}
      isAdmin={data.actor.platformRole === "admin"}
    />
    <CommentSection
      postId={data.post.id}
      type={data.type}
      comments={data.comments}
      viewerId={data.actor.userId}
      isAdmin={data.actor.platformRole === "admin"}
    />
  </Section>
</PageContainer>
