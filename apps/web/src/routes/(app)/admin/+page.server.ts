import type { PageServerLoad } from "./$types";
import { adminDomain } from "@nojv/application";

const { getAdminDashboard, getSystemHealth } = adminDomain;

export const load: PageServerLoad = async () => {
  const [dashboard, health] = await Promise.all([getAdminDashboard(), getSystemHealth()]);
  return { ...dashboard, health };
};
