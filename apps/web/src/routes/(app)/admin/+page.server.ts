import type { PageServerLoad } from "./$types";
import { adminDomain } from "@nojv/domain";

const { getAdminDashboard } = adminDomain;

export const load: PageServerLoad = async () => {
  return getAdminDashboard();
};
