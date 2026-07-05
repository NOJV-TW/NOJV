import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  return {
    repoUrl: "https://github.com/NOJV-TW/NOJV",
    contactEmail: "nojv.tw@gmail.com",
    developers: [
      { id: "a" as const, name: "Takala", github: "TakalaWang" },
      { id: "b" as const, name: "Roku", github: "RokuSennyou" },
      { id: "c" as const, name: "NZ", github: "su-nz" },
    ],
  };
};
