import { z } from "zod";
import { verificationDomain } from "@nojv/domain";

import type { PageServerLoad } from "./$types";

const { processSchoolVerification } = verificationDomain;

const verificationDataSchema = z.object({ username: z.string().min(1) });

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get("token");

  if (!token) {
    return { status: "error" as const, detail: "缺少驗證 token" };
  }

  return processSchoolVerification(token, (value: string) => {
    const parsed = verificationDataSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  });
};
