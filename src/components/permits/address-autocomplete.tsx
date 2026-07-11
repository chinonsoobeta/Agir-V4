import { useEffect, useId, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";

/** The six pilot municipalities, keyed by the city name Photon/OSM returns.
 * Values match `jurisdictions.name` exactly so candidate generation works. */
const PILOT_MUNICIPALITY_MAP: Record<string, string> = {
  burnaby: "City of Burnaby",
  kelowna: "City of Kelowna",
  "new westminster": "City of New Westminster",
  richmond: "City of Richmond",
  surrey: "City of Surrey",
  vancouver: "City of Vancouver",
};

export type AddressSelection = {
  address: string;
  municipality: string | null;
  province: string | null;
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
  const city = (p.city ?? p.district ?? p.county ?? "").toLowerCase().trim();
  if (!city) return null;
  return PILOT_MUNICIPALITY_MAP[city] ?? p.city ?? p.district ?? p.county ?? null;
}

/** Free-text address input with Photon (OpenStreetMap) suggestions, biased to
 * British Columbia. Selecting a suggestion reports the resolved municipality. */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: AddressSelection) => void;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const skipNextFetch = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const statusId = useId();

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let controller: AbortController | null = null;
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        // Bias and clamp results to British Columbia.
        const url =
          "https://photon.komoot.io/api?" +
          new URLSearchParams({
            q,
            limit: "6",
            lang: "en",
            lat: "49.25",
            lon: "-123.1",
            bbox: "-139.06,48.2,-114.03,60.0",
          });
        const res = await fetch(url, {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!res.ok) throw new Error(`Photon ${res.status}`);
        const json = await res.json();
        const features: PhotonFeature[] = (json.features ?? []).filter(
          (f: PhotonFeature) => f.properties?.countrycode === "CA",
        );
        setSuggestions(features);
        setOpen(features.length > 0);
        setActive(-1);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controller?.abort();
    };
  }, [value]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const choose = (f: PhotonFeature) => {
    const label = formatAddressSuggestion(f.properties);
    skipNextFetch.current = true;
    onChange(label);
    onSelect({
      address: label,
      municipality: resolveSuggestedMunicipality(f.properties),
      province: f.properties.state ?? null,
    });
    setOpen(false);
    setSuggestions([]);
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={active >= 0 ? `${listboxId}-option-${active}` : undefined}
        aria-describedby={statusId}
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
          : open
            ? `${suggestions.length} address suggestions available`
            : ""}
      </span>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((f, i) => {
            const label = formatAddressSuggestion(f.properties);
            return (
              <li
                key={`${label}-${i}`}
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
                  i === active ? "bg-accent text-accent-foreground" : ""
                }`}
                onPointerEnter={() => setActive(i)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(f);
                }}
              >
                <MapPin aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{label}</span>
              </li>
            );
          })}
          <li className="px-2 py-1 text-xs text-muted-foreground" aria-hidden>
            Suggestions from OpenStreetMap
          </li>
        </ul>
      )}
    </div>
  );
}
