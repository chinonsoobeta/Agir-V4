import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { savePreferenceData } from "./preferences.functions";

// Self-service deal-flow customization: saved filter/sort/column views and
// column visibility. Source of truth is localStorage (instant, reversible, no
// migration dependency); each change is ALSO mirrored to user_preferences
// best-effort so it follows the user across devices when the table exists.
// Everything here is reversible and resettable — no schema names are exposed.

export type DealSort = "updated" | "investment" | "confidence" | "capital" | "close" | "name";

export type DealColumnKey =
  | "stage"
  | "source"
  | "capital"
  | "probability"
  | "investment"
  | "confidence"
  | "close";

export const DEAL_COLUMNS: { key: DealColumnKey; label: string; align: "left" | "right" }[] = [
  { key: "stage", label: "Stage", align: "left" },
  { key: "source", label: "Source", align: "left" },
  { key: "capital", label: "Capital", align: "right" },
  { key: "probability", label: "Probability", align: "right" },
  { key: "investment", label: "Investment", align: "right" },
  { key: "confidence", label: "Confidence", align: "right" },
  { key: "close", label: "Target close", align: "left" },
];

export const DEFAULT_COLUMNS: DealColumnKey[] = DEAL_COLUMNS.map((c) => c.key);

export const DEAL_SORTS: { value: DealSort; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "investment", label: "Investment score" },
  { value: "confidence", label: "Confidence score" },
  { value: "capital", label: "Capital" },
  { value: "close", label: "Target close" },
  { value: "name", label: "Name" },
];

export type DealViewState = {
  filter: string;
  search: string;
  sort: DealSort;
  view: "grid" | "list";
  columns: DealColumnKey[];
};

export type SavedDealView = { id: string; name: string } & DealViewState;

const VIEWS_KEY = "agir-deal-views";

function readViews(): SavedDealView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VIEWS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Pure deterministic ordering used by the deals list. Exported for tests. */
export function sortDeals<
  T extends {
    updatedAt: string;
    investmentScore: number | null;
    confidenceScore: number;
    capital: number;
    targetCloseDate: string | null;
    name: string;
  },
>(deals: T[], sort: DealSort): T[] {
  const copy = [...deals];
  switch (sort) {
    case "investment":
      return copy.sort((a, b) => (b.investmentScore ?? -1) - (a.investmentScore ?? -1));
    case "confidence":
      return copy.sort((a, b) => b.confidenceScore - a.confidenceScore);
    case "capital":
      return copy.sort((a, b) => b.capital - a.capital);
    case "close":
      // Soonest close first; deals without a date sort last.
      return copy.sort((a, b) => {
        const av = a.targetCloseDate ? Date.parse(a.targetCloseDate) : Infinity;
        const bv = b.targetCloseDate ? Date.parse(b.targetCloseDate) : Infinity;
        return av - bv;
      });
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "updated":
    default:
      return copy.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
}

export function useSavedDealViews() {
  const [views, setViews] = useState<SavedDealView[]>(readViews);
  const saveFn = useServerFn(savePreferenceData);

  // Mirror to the server best-effort (ignore failures / missing table).
  const mirror = useCallback(
    (next: SavedDealView[]) => {
      Promise.resolve(saveFn({ data: { key: "dealViews", value: next } })).catch(() => {});
    },
    [saveFn],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  }, [views]);

  const save = useCallback(
    (name: string, state: DealViewState) => {
      const id = `${name.toLowerCase().replace(/\s+/g, "-")}-${state.sort}`;
      setViews((prev) => {
        const next = [...prev.filter((v) => v.id !== id), { id, name, ...state }];
        mirror(next);
        return next;
      });
      return id;
    },
    [mirror],
  );

  const remove = useCallback(
    (id: string) => {
      setViews((prev) => {
        const next = prev.filter((v) => v.id !== id);
        mirror(next);
        return next;
      });
    },
    [mirror],
  );

  return { views, save, remove };
}
