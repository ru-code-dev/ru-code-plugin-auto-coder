import { createLocale, type Locale } from "@smart-tools/plugin-sdk/locale";

export type AutoCoderLocale = Locale;

export const pluginLocale = createLocale();

export const {
  L,
  LT,
  LN,
  currentLocale,
  configure: configureAutoCoderLocale,
  reset: resetAutoCoderLocale,
} = pluginLocale;
