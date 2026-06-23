import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppTheme = "light" | "dark" | "system";
export type AppLanguage = "en" | "fr";

type PreferencesContextValue = {
  theme: AppTheme;
  resolvedTheme: "light" | "dark";
  language: AppLanguage;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;
  t: (key: TranslationKey) => string;
};

const copy = {
  en: {
    "nav.home": "Overview",
    "nav.portfolio": "Portfolio",
    "nav.deals": "Deal flow",
    "nav.execution": "Execution",
    "nav.markets": "Markets",
    "nav.committee": "Investment Committee",
    "nav.documents": "Documents",
    "nav.analysis": "Analysis",
    "nav.reports": "Reports",
    "nav.integrations": "Integrations",
    "nav.copilot": "Copilot",
    "nav.settings": "Settings",
    "nav.signOut": "Sign out",
    "shell.workspace": "Investment OS",
    "shell.live": "Live",
    "settings.title": "Settings",
    "settings.subtitle": "Account, appearance and workspace preferences",
    "settings.account": "Account",
    "settings.appearance": "Appearance",
    "settings.theme": "Theme",
    "settings.language": "Language",
    "settings.dark": "Dark",
    "settings.light": "Light",
    "settings.system": "System",
    "settings.english": "English",
    "settings.french": "French",
  },
  fr: {
    "nav.home": "Vue d’ensemble",
    "nav.portfolio": "Portefeuille",
    "nav.deals": "Flux d’affaires",
    "nav.execution": "Exécution",
    "nav.markets": "Marchés",
    "nav.committee": "Comité d’investissement",
    "nav.documents": "Documents",
    "nav.analysis": "Analyse",
    "nav.reports": "Rapports",
    "nav.integrations": "Intégrations",
    "nav.copilot": "Copilote",
    "nav.settings": "Paramètres",
    "nav.signOut": "Déconnexion",
    "shell.workspace": "Système d’investissement",
    "shell.live": "En direct",
    "settings.title": "Paramètres",
    "settings.subtitle": "Compte, apparence et préférences de l’espace de travail",
    "settings.account": "Compte",
    "settings.appearance": "Apparence",
    "settings.theme": "Thème",
    "settings.language": "Langue",
    "settings.dark": "Sombre",
    "settings.light": "Clair",
    "settings.system": "Système",
    "settings.english": "Anglais",
    "settings.french": "Français",
  },
} as const;

export type TranslationKey = keyof typeof copy.en;

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function storedTheme(): AppTheme {
  if (typeof window === "undefined") return "dark";
  const value = window.localStorage.getItem("agir-theme");
  return value === "light" || value === "dark" || value === "system" ? value : "dark";
}

function storedLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem("agir-language") === "fr" ? "fr" : "en";
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
    window.localStorage.setItem("agir-theme", theme);
    window.localStorage.setItem("agir-language", language);
  }, [theme, resolvedTheme, language]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      theme,
      resolvedTheme,
      language,
      setTheme: setThemeState,
      setLanguage: setLanguageState,
      t: (key) => copy[language][key] ?? copy.en[key],
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
