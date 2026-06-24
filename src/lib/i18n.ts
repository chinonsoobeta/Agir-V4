// Maintainable translation + locale-formatting layer.
//
// Agir ships English and Canadian French. We keep a dependency-free, strongly
// typed dictionary (one source of truth, `en` defines the key set) plus
// locale-aware Intl formatters so dates and numbers render correctly in both
// languages. English is always the fallback for any missing French string.
//
// This module is framework-free so it can be used in server functions,
// deterministic helpers and React components alike. The React binding lives in
// `preferences.tsx`.

export type AppLanguage = "en" | "fr";

// The English dictionary defines the canonical key set. French is checked for
// parity at build time via `TranslationKey` but missing keys fall back to en.
export const en = {
  // ---- Navigation ----
  "nav.home": "Overview",
  "nav.portfolio": "Portfolio",
  "nav.deals": "Deal flow",
  "nav.execution": "Execution",
  "nav.markets": "Markets",
  "nav.committee": "Investment Committee",
  "nav.documents": "Documents",
  "nav.analysis": "Analysis",
  "nav.reports": "Reports",
  "nav.compare": "Compare",
  "nav.integrations": "Integrations",
  "nav.copilot": "Copilot",
  "nav.settings": "Settings",
  "nav.signOut": "Sign out",

  // ---- Shell ----
  "shell.workspace": "Investment OS",
  "shell.live": "Live",
  "shell.offline": "Offline",

  // ---- Common actions ----
  "action.new": "New",
  "action.create": "Create",
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.delete": "Delete",
  "action.edit": "Edit",
  "action.close": "Close",
  "action.back": "Back",
  "action.search": "Search",
  "action.filter": "Filter",
  "action.apply": "Apply",
  "action.reset": "Reset",
  "action.retry": "Try again",
  "action.export": "Export",
  "action.viewAll": "View all",
  "action.openDeal": "Open deal",
  "action.newDeal": "New deal",
  "action.createDeal": "Create deal",
  "action.uploadDocument": "Upload document",
  "action.runUnderwriting": "Run underwriting",
  "action.prepareCommittee": "Prepare committee",
  "action.addMilestone": "Add milestone",
  "action.generateReport": "Generate report",
  "action.compareDeals": "Compare deals",
  "action.dismiss": "Dismiss",
  "action.resume": "Resume",
  "action.skip": "Skip",
  "action.dismissAll": "Dismiss checklist",

  // ---- Common nouns / labels ----
  "common.loading": "Loading…",
  "common.all": "All",
  "common.none": "None",
  "common.owner": "Owner",
  "common.status": "Status",
  "common.priority": "Priority",
  "common.dueDate": "Due date",
  "common.target": "Target close",
  "common.capital": "Capital",
  "common.stage": "Stage",
  "common.source": "Source",
  "common.assetType": "Asset type",
  "common.market": "Market",
  "common.risk": "Risk",
  "common.deal": "Deal",
  "common.deals": "Deals",
  "common.actions": "Actions",
  "common.dataAsOf": "Data as of",
  "common.nextAction": "Next action",
  "common.overdue": "Overdue",
  "common.dueSoon": "Due soon",
  "common.noData": "No data yet",
  "common.optional": "optional",
  "common.deterministic": "Deterministic calculation",
  "common.ruleBased": "Rule-based finding",
  "common.marketComparison": "Market comparison",
  "common.operationalAlert": "Operational alert",
  "common.aiExplanation": "AI-written explanation",

  // ---- Recommendation labels (mirror decision.ts codes) ----
  "rec.APPROVE": "Approve",
  "rec.APPROVE_WITH_CONDITIONS": "Approve with Conditions",
  "rec.RETURN_TO_UNDERWRITING": "Return to Underwriting",
  "rec.REJECT": "Reject",

  // ---- Risk ratings ----
  "risk.Low": "Low",
  "risk.Moderate": "Moderate",
  "risk.High": "High",
  "risk.Critical": "Critical",

  // ---- Pipeline stages ----
  "stage.Screening": "Screening",
  "stage.Document Review": "Document Review",
  "stage.Underwriting": "Underwriting",
  "stage.Investment Committee": "Investment Committee",
  "stage.Approved": "Approved",
  "stage.Rejected": "Rejected",

  // ---- Milestone / task status ----
  "mstatus.not_started": "Not started",
  "mstatus.in_progress": "In progress",
  "mstatus.blocked": "Blocked",
  "mstatus.complete": "Complete",

  // ---- Page headers ----
  "page.dashboard.eyebrow": "Investment OS",
  "page.dashboard.title": "Overview",
  "page.dashboard.subtitle": "What requires your attention right now",
  "page.deals.eyebrow": "Pipeline",
  "page.deals.title": "Deal flow",
  "page.deals.subtitle": "What is moving, stalled, or attractive",
  "page.portfolio.eyebrow": "Portfolio",
  "page.portfolio.title": "Portfolio",
  "page.portfolio.subtitle": "Where returns and risks are concentrated",
  "page.execution.eyebrow": "Execution",
  "page.execution.title": "Execution",
  "page.execution.subtitle": "What could delay closing",
  "page.markets.eyebrow": "Market intelligence",
  "page.markets.title": "Markets",
  "page.markets.subtitle": "External changes that affect decisions",
  "page.reports.eyebrow": "Reporting",
  "page.reports.title": "Reports",
  "page.reports.subtitle": "What must be communicated",
  "page.compare.eyebrow": "Comparison",
  "page.compare.title": "Compare deals",
  "page.compare.subtitle": "Side-by-side, straight from the deterministic engine",
  "page.settings.title": "Settings",
  "page.settings.subtitle": "Account, appearance and workspace preferences",

  // ---- Settings page ----
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
  "settings.email": "Email",
  "settings.roles": "Roles",
  "settings.notifications": "Notifications",

  // ---- Empty states ----
  "empty.deals.title": "No deals yet",
  "empty.deals.body":
    "Create your first deal or load the guided demo to see the pipeline come to life.",
  "empty.milestones.title": "No milestones yet",
  "empty.milestones.body":
    "Add execution milestones or apply a checklist template to track the path to close.",
  "empty.reports.title": "Nothing to report yet",
  "empty.reports.body": "Run underwriting on a deal to unlock portfolio reports.",
  "empty.timeline.title": "No activity yet",
  "empty.timeline.body": "Events appear here as the deal progresses.",
  "empty.compare.title": "Pick deals to compare",
  "empty.compare.body": "Select two or more underwritten deals to see them side by side.",

  // ---- Onboarding ----
  "onb.title": "Get set up",
  "onb.subtitle": "Reach a real underwriting result in about 15 minutes — no admin required.",
  "onb.progress": "{done} of {total} done",
  "onb.complete": "You're set up",
  "onb.completeBody": "Every step is done. You can always revisit this from Settings.",
  "onb.resume": "Resume setup",
  "onb.demoHint": "In a hurry? Load the guided demo deal to see a finished example.",
  "onb.loadDemo": "Load guided demo",
  "onb.step.createDeal.title": "Create your first deal",
  "onb.step.createDeal.body": "Start from a template or a blank deal. Only a name is required.",
  "onb.step.uploadDocs.title": "Upload documents",
  "onb.step.uploadDocs.body":
    "Drop in an offering memo, rent roll or budget. Agir extracts assumptions with provenance.",
  "onb.step.reviewAssumptions.title": "Review extracted assumptions",
  "onb.step.reviewAssumptions.body":
    "Approve, correct or resolve conflicts. Nothing is invented — every value is traceable.",
  "onb.step.runUnderwriting.title": "Run underwriting",
  "onb.step.runUnderwriting.body":
    "The deterministic engine produces returns, debt metrics and stress cases.",
  "onb.step.prepareCommittee.title": "Prepare a committee decision",
  "onb.step.prepareCommittee.body":
    "Review the recommendation, scores and conditions, then record a decision.",
  "onb.step.addMilestones.title": "Add execution milestones",
  "onb.step.addMilestones.body":
    "Track diligence, financing and closing deadlines, owners and blockers.",

  // ---- Reports (portfolio analytics) ----
  "rep.pipeline_conversion": "Pipeline conversion",
  "rep.capital_deployment": "Capital deployment",
  "rep.deal_velocity": "Deal velocity",
  "rep.risk_confidence": "Risk & confidence",
  "rep.upcoming_deadlines": "Upcoming deadlines",
  "rep.concentration": "Portfolio concentration",
  "rep.decision_history": "Decision history",
  "rep.sourcing": "Sourcing",
  "rep.section.portfolio": "Portfolio analytics",
  "rep.section.deal": "Deal documents",
  "rep.deterministic": "All figures come from the deterministic engine. Nothing here is estimated.",
} as const;

export type TranslationKey = keyof typeof en;

// French — Canadian. Missing keys fall back to English at lookup time.
export const fr: Partial<Record<TranslationKey, string>> = {
  "nav.home": "Vue d’ensemble",
  "nav.portfolio": "Portefeuille",
  "nav.deals": "Flux d’affaires",
  "nav.execution": "Exécution",
  "nav.markets": "Marchés",
  "nav.committee": "Comité d’investissement",
  "nav.documents": "Documents",
  "nav.analysis": "Analyse",
  "nav.reports": "Rapports",
  "nav.compare": "Comparer",
  "nav.integrations": "Intégrations",
  "nav.copilot": "Copilote",
  "nav.settings": "Paramètres",
  "nav.signOut": "Déconnexion",

  "shell.workspace": "Système d’investissement",
  "shell.live": "En direct",
  "shell.offline": "Hors ligne",

  "action.new": "Nouveau",
  "action.create": "Créer",
  "action.save": "Enregistrer",
  "action.cancel": "Annuler",
  "action.delete": "Supprimer",
  "action.edit": "Modifier",
  "action.close": "Fermer",
  "action.back": "Retour",
  "action.search": "Rechercher",
  "action.filter": "Filtrer",
  "action.apply": "Appliquer",
  "action.reset": "Réinitialiser",
  "action.retry": "Réessayer",
  "action.export": "Exporter",
  "action.viewAll": "Tout voir",
  "action.openDeal": "Ouvrir l’affaire",
  "action.newDeal": "Nouvelle affaire",
  "action.createDeal": "Créer l’affaire",
  "action.uploadDocument": "Téléverser un document",
  "action.runUnderwriting": "Lancer l’analyse",
  "action.prepareCommittee": "Préparer le comité",
  "action.addMilestone": "Ajouter un jalon",
  "action.generateReport": "Générer un rapport",
  "action.compareDeals": "Comparer les affaires",
  "action.dismiss": "Ignorer",
  "action.resume": "Reprendre",
  "action.skip": "Passer",
  "action.dismissAll": "Masquer la liste",

  "common.loading": "Chargement…",
  "common.all": "Toutes",
  "common.none": "Aucune",
  "common.owner": "Responsable",
  "common.status": "Statut",
  "common.priority": "Priorité",
  "common.dueDate": "Échéance",
  "common.target": "Clôture cible",
  "common.capital": "Capital",
  "common.stage": "Étape",
  "common.source": "Source",
  "common.assetType": "Type d’actif",
  "common.market": "Marché",
  "common.risk": "Risque",
  "common.deal": "Affaire",
  "common.deals": "Affaires",
  "common.actions": "Actions",
  "common.dataAsOf": "Données au",
  "common.nextAction": "Prochaine action",
  "common.overdue": "En retard",
  "common.dueSoon": "Bientôt dû",
  "common.noData": "Aucune donnée",
  "common.optional": "facultatif",
  "common.deterministic": "Calcul déterministe",
  "common.ruleBased": "Constat basé sur des règles",
  "common.marketComparison": "Comparaison de marché",
  "common.operationalAlert": "Alerte opérationnelle",
  "common.aiExplanation": "Explication rédigée par l’IA",

  "rec.APPROVE": "Approuver",
  "rec.APPROVE_WITH_CONDITIONS": "Approuver sous conditions",
  "rec.RETURN_TO_UNDERWRITING": "Retour à l’analyse",
  "rec.REJECT": "Rejeter",

  "risk.Low": "Faible",
  "risk.Moderate": "Modéré",
  "risk.High": "Élevé",
  "risk.Critical": "Critique",

  "stage.Screening": "Présélection",
  "stage.Document Review": "Revue documentaire",
  "stage.Underwriting": "Analyse",
  "stage.Investment Committee": "Comité d’investissement",
  "stage.Approved": "Approuvée",
  "stage.Rejected": "Rejetée",

  "mstatus.not_started": "À faire",
  "mstatus.in_progress": "En cours",
  "mstatus.blocked": "Bloqué",
  "mstatus.complete": "Terminé",

  "page.dashboard.eyebrow": "Système d’investissement",
  "page.dashboard.title": "Vue d’ensemble",
  "page.dashboard.subtitle": "Ce qui requiert votre attention maintenant",
  "page.deals.eyebrow": "Pipeline",
  "page.deals.title": "Flux d’affaires",
  "page.deals.subtitle": "Ce qui avance, stagne ou attire",
  "page.portfolio.eyebrow": "Portefeuille",
  "page.portfolio.title": "Portefeuille",
  "page.portfolio.subtitle": "Où se concentrent rendements et risques",
  "page.execution.eyebrow": "Exécution",
  "page.execution.title": "Exécution",
  "page.execution.subtitle": "Ce qui pourrait retarder la clôture",
  "page.markets.eyebrow": "Intelligence de marché",
  "page.markets.title": "Marchés",
  "page.markets.subtitle": "Les changements externes qui influent sur les décisions",
  "page.reports.eyebrow": "Rapports",
  "page.reports.title": "Rapports",
  "page.reports.subtitle": "Ce qui doit être communiqué",
  "page.compare.eyebrow": "Comparaison",
  "page.compare.title": "Comparer les affaires",
  "page.compare.subtitle": "Côte à côte, directement depuis le moteur déterministe",
  "page.settings.title": "Paramètres",
  "page.settings.subtitle": "Compte, apparence et préférences de l’espace de travail",

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
  "settings.email": "Courriel",
  "settings.roles": "Rôles",
  "settings.notifications": "Notifications",

  "empty.deals.title": "Aucune affaire",
  "empty.deals.body":
    "Créez votre première affaire ou chargez la démo guidée pour voir le pipeline prendre vie.",
  "empty.milestones.title": "Aucun jalon",
  "empty.milestones.body":
    "Ajoutez des jalons d’exécution ou appliquez un modèle de liste pour suivre le chemin vers la clôture.",
  "empty.reports.title": "Rien à rapporter",
  "empty.reports.body":
    "Lancez l’analyse d’une affaire pour débloquer les rapports de portefeuille.",
  "empty.timeline.title": "Aucune activité",
  "empty.timeline.body": "Les événements apparaissent ici au fil de l’avancement de l’affaire.",
  "empty.compare.title": "Choisissez des affaires à comparer",
  "empty.compare.body": "Sélectionnez deux affaires analysées ou plus pour les voir côte à côte.",

  "onb.title": "Configuration",
  "onb.subtitle": "Obtenez un vrai résultat d’analyse en environ 15 minutes — sans administrateur.",
  "onb.progress": "{done} sur {total} terminés",
  "onb.complete": "Tout est prêt",
  "onb.completeBody": "Chaque étape est terminée. Vous pouvez revenir ici depuis les Paramètres.",
  "onb.resume": "Reprendre la configuration",
  "onb.demoHint": "Pressé ? Chargez l’affaire de démonstration pour voir un exemple complet.",
  "onb.loadDemo": "Charger la démo",
  "onb.step.createDeal.title": "Créez votre première affaire",
  "onb.step.createDeal.body": "Partez d’un modèle ou d’une affaire vierge. Seul le nom est requis.",
  "onb.step.uploadDocs.title": "Téléversez des documents",
  "onb.step.uploadDocs.body":
    "Déposez un mémorandum, un état locatif ou un budget. Agir en extrait les hypothèses avec provenance.",
  "onb.step.reviewAssumptions.title": "Révisez les hypothèses extraites",
  "onb.step.reviewAssumptions.body":
    "Approuvez, corrigez ou résolvez les conflits. Rien n’est inventé — chaque valeur est traçable.",
  "onb.step.runUnderwriting.title": "Lancez l’analyse",
  "onb.step.runUnderwriting.body":
    "Le moteur déterministe produit rendements, ratios de dette et scénarios de stress.",
  "onb.step.prepareCommittee.title": "Préparez une décision de comité",
  "onb.step.prepareCommittee.body":
    "Examinez la recommandation, les scores et les conditions, puis consignez une décision.",
  "onb.step.addMilestones.title": "Ajoutez des jalons d’exécution",
  "onb.step.addMilestones.body":
    "Suivez les échéances de diligence, de financement et de clôture, les responsables et les blocages.",

  "rep.pipeline_conversion": "Conversion du pipeline",
  "rep.capital_deployment": "Déploiement du capital",
  "rep.deal_velocity": "Vélocité des affaires",
  "rep.risk_confidence": "Risque et confiance",
  "rep.upcoming_deadlines": "Échéances à venir",
  "rep.concentration": "Concentration du portefeuille",
  "rep.decision_history": "Historique des décisions",
  "rep.sourcing": "Sourçage",
  "rep.section.portfolio": "Analyses de portefeuille",
  "rep.section.deal": "Documents d’affaire",
  "rep.deterministic":
    "Tous les chiffres proviennent du moteur déterministe. Rien ici n’est estimé.",
};

const DICTS: Record<AppLanguage, Partial<Record<TranslationKey, string>>> = { en, fr };

/** Translate a key for a language, falling back to English, then the key itself. */
export function translate(language: AppLanguage, key: TranslationKey): string {
  return DICTS[language][key] ?? en[key] ?? key;
}

/** Interpolate `{name}` placeholders, e.g. translateWith(lang, "onb.progress", {done, total}). */
export function translateWith(
  language: AppLanguage,
  key: TranslationKey,
  vars: Record<string, string | number>,
): string {
  return translate(language, key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function localeFor(language: AppLanguage): string {
  return language === "fr" ? "fr-CA" : "en-CA";
}

export type Formatters = {
  currency: (value: number, opts?: Intl.NumberFormatOptions) => string;
  /** Compact currency, e.g. $1.2M / 1,2 M$. */
  compactCurrency: (value: number) => string;
  number: (value: number, opts?: Intl.NumberFormatOptions) => string;
  /** Value already expressed in percent units (6 → "6%"). */
  percent: (value: number, digits?: number) => string;
  /** Equity-multiple style, e.g. 1.75 → "1.75x". */
  multiple: (value: number, digits?: number) => string;
  date: (value: string | number | Date, opts?: Intl.DateTimeFormatOptions) => string;
};

/** Build a set of Intl-backed formatters bound to a language. Safe on server. */
export function makeFormatters(language: AppLanguage): Formatters {
  const locale = localeFor(language);
  return {
    currency: (value, opts) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
        ...opts,
      }).format(Number.isFinite(value) ? value : 0),
    compactCurrency: (value) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(Number.isFinite(value) ? value : 0),
    number: (value, opts) =>
      new Intl.NumberFormat(locale, opts).format(Number.isFinite(value) ? value : 0),
    percent: (value, digits = 1) =>
      `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(Number.isFinite(value) ? value : 0)} %`,
    multiple: (value, digits = 2) =>
      `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(Number.isFinite(value) ? value : 0)}x`,
    date: (value, opts) =>
      new Intl.DateTimeFormat(
        locale,
        opts ?? { year: "numeric", month: "short", day: "numeric" },
      ).format(value instanceof Date ? value : new Date(value)),
  };
}
