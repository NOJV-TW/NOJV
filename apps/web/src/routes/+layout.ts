import { browser } from "$app/env";
import { syncServerClock } from "#lib/utils/datetime.js";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = ({ data }) => {
  if (browser) syncServerClock(data.serverNow);
  return data;
};
