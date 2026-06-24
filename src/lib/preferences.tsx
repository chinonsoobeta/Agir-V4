import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  type AppLanguage,
  type Formatters,
  type TranslationKey,
  localeFor,
  makeFormatters,
  translate,
  translateWith,
} from "./i18n";

export type AppTheme = "light" | "dark" | "system";
export type { AppLanguage, TranslationKey } from "./i18n";

type PreferencesContextValue = {
  theme: AppTheme;
  resolvedTheme: "light" | "dark";
  language: AppLanguage;
  locale: string;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;
  t: (key: TranslationKey) => string;
  tx: (key: TranslationKey, vars: Record<string, string | number>) => string;
  fmt: Formatters;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const THEME_KEY = "agir-theme";
const LANG_KEY = "agir-language";

function storedTheme(): AppTheme {
  if (typeof window === "undefined") return "dark";
  const value = window.localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "dark";
}

function storedLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(LANG_KEY) === "fr" ? "fr" : "en";
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(storedTheme);
  const [language, setLanguageState] = useState<AppLanguage>(storedLanguage);
  const [systemDark, setSystemDark] = useState(true);
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.classList.toggle("light", resolvedTheme === "light");
    root.style.colorScheme = resolvedTheme;
    root.lang = language;
    window.localStorage.setItem(THEME_KEY, theme);
    window.localStorage.setItem(LANG_KEY, language);
  }, [theme, resolvedTheme, language]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      theme,
      resolvedTheme,
      language,
      locale: localeFor(language),
      setTheme: setThemeState,
      setLanguage: setLanguageState,
      t: (key) => translate(language, key),
      tx: (key, vars) => translateWith(language, key, vars),
      fmt: makeFormatters(language),
    }),
    [theme, resolvedTheme, language],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used within PreferencesProvider");
  return value;
}
