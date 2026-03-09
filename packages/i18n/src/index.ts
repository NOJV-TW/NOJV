import { localeCodes, localeCodeSchema, type LocaleCode } from "@nojv/domain";

export const locales = [...localeCodes];
export const defaultLocale: LocaleCode = "zh-TW";

export function isLocale(value: string): value is LocaleCode {
  return localeCodeSchema.safeParse(value).success;
}

export function resolveLocale(value?: string): LocaleCode {
  if (!value) {
    return defaultLocale;
  }

  return isLocale(value) ? value : defaultLocale;
}

export type { LocaleCode };
