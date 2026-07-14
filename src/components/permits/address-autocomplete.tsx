import { useEffect, useId, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { canonicalPermitMunicipality } from "@/lib/permit-municipalities";
import { searchAddresses, type AddressSearchResult } from "@/lib/address-search.functions";

/** Provider results are normalized through the shared municipality catalogue.
 * Canonical values match `jurisdictions.name` exactly so research stays scoped. */

export type AddressSelection = {
  address: string;
  addressLine1: string;
  buildingName: string | null;
  municipality: string | null;
  province: string | null;
  postalCode: string | null;
  provider: "google_places" | "openstreetmap";
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
};

type PhotonFeature = {
  properties: {
    housenumber?: string;
    street?: string;
    name?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
};

export function formatAddressSuggestion(p: PhotonFeature["properties"]) {
  const line1 = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : (p.street ?? p.name)]
    .filter(Boolean)
    .join("");
  const city = p.city ?? p.district ?? p.county ?? "";
  const parts = [line1, city, p.state, p.postcode].filter(Boolean);
  return parts.join(", ");
}

export function resolveSuggestedMunicipality(p: PhotonFeature["properties"]): string | null {
  const supplied = p.city ?? p.district ?? p.county ?? "";
  if (!supplied.trim()) return null;
  return canonicalPermitMunicipality(supplied);
}

/** Free-text address/building lookup. The server uses Google Places when
 * configured and a labelled OpenStreetMap fallback otherwise. */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: AddressSelection) => void;
  placeholder?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<AddressSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const requestIdRef = useRef(0);
  const skipNextFetch = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const statusId = useId();
  const search = useServerFn(searchAddresses);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      setSearchError(false);
      return;
    }
    const t = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setSearchError(false);
      try {
        const results = await search({ data: { query: q } });
        if (requestId !== requestIdRef.current) return;
        setSuggestions(results);
        setOpen(results.length > 0);
        setActive(-1);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setSuggestions([]);
        setOpen(false);
        setSearchError(true);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      requestIdRef.current += 1;
    };
  }, [search, value]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const choose = (result: AddressSearchResult) => {
    skipNextFetch.current = true;
    onChange(result.addressLine1);
    onSelect(result);
    setOpen(false);
    setSuggestions([]);
    setSearchError(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (active >= 0 && suggestions[active]) {
        e.preventDefault();
        choose(suggestions[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && active >= 0 ? `${listboxId}-option-${active}` : undefined}
        aria-describedby={[ariaDescribedBy, statusId].filter(Boolean).join(" ")}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {loading && (
        <Loader2
          aria-hidden
          className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      )}
      <span id={statusId} className="sr-only" role="status" aria-live="polite">
        {loading
          ? "Loading address suggestions"
          : searchError
            ? "Address suggestions are unavailable. You can enter the address manually."
            : open
              ? `${suggestions.length} address suggestions available`
              : ""}
      </span>
      {searchError && (
        <p className="mt-1 text-xs text-muted-foreground" role="alert">
          Suggestions are unavailable. Enter the address manually.
        </p>
      )}
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((result, i) => {
            return (
              <li
                key={`${result.provider}-${result.placeId ?? result.address}-${i}`}
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
                  i === active ? "bg-accent text-accent-foreground" : ""
                }`}
                onPointerEnter={() => setActive(i)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(result);
                }}
              >
                <MapPin aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  {result.buildingName && (
                    <span className="block truncate font-medium">{result.buildingName}</span>
                  )}
                  <span className="block truncate">{result.address}</span>
                </span>
              </li>
            );
          })}
          <li className="px-2 py-1 text-xs text-muted-foreground" aria-hidden>
            Suggestions identify their source and never confirm municipality or zoning.
          </li>
        </ul>
      )}
    </div>
  );
}
