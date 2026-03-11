import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

const supportedLocales = ["en", "zh-TW"];

export const load: LayoutServerLoad = async ({ params }) => {
  if (!supportedLocales.includes(params.locale)) {
    error(404, "Unsupported locale");
  }

  return {
    locale: params.locale
  };
};
