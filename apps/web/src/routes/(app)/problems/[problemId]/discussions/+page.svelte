<script lang="ts">
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PostList from "$lib/components/features/posts/PostList.svelte";

  let { data } = $props();
</script>

<PageContainer>
  <PostList
    type={data.type}
    problem={data.problem}
    posts={data.posts}
    total={data.total}
    page={data.page}
    pageSize={data.pageSize}
  />
</PageContainer>
