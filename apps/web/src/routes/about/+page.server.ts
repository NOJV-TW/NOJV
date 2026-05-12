import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  return {
    repoUrl: "https://github.com/your-org/nojv",
    contactEmail: "contact@example.com",
    developers: [
      { id: "a" as const, name: "Developer A", github: "githubuser-1" },
      { id: "b" as const, name: "Developer B", github: "githubuser-2" },
      { id: "c" as const, name: "Developer C", github: "githubuser-3" },
    ],
  };
};
