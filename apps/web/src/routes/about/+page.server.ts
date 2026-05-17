import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  return {
    repoUrl: "https://github.com/TakalaWang/NOJV",
    contactEmail: "contact@example.com",
    developers: [
      { id: "a" as const, name: "Takala Wang", github: "TakalaWang" },
      { id: "b" as const, name: "RokuSennyou", github: "RokuSennyou" },
      { id: "c" as const, name: "蘇恩立(NZ)", github: "su-nz" },
    ],
  };
};
