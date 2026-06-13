import type { PageServerLoad } from "./$types";
import { adminDomain } from "@nojv/application";

const { getAdminDashboard } = adminDomain;

export const load: PageServerLoad = async () => {
  return getAdminDashboard();
};
