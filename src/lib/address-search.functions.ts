import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canonicalPermitMunicipality } from "./permit-municipalities";

export type AddressSearchResult = {
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

const ADDRESS_SEARCH_TIMEOUT_MS = 6_000;

type GoogleAddressComponent = {
  longText?: string;
  types?: string[];
};

function component(components: GoogleAddressComponent[] | undefined, type: string) {
  return components?.find((item) => item.types?.includes(type))?.longText ?? null;
}

export function resolveAddressBuildingName(
  displayName: string | null,
  street: string,
  formattedAddress: string,
) {
  const display = displayName?.trim();
  if (!display) return null;
  const normalized = display.toLocaleLowerCase("en-CA");
  if (
    normalized === street.trim().toLocaleLowerCase("en-CA") ||
    normalized === formattedAddress.trim().toLocaleLowerCase("en-CA")
  )
    return null;
  return display;
}

async function searchGoogle(query: string, apiKey: string): Promise<AddressSearchResult[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-fieldmask":
        "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location",
    },
    body: JSON.stringify({
      textQuery: `${query}, British Columbia, Canada`,
      languageCode: "en",
      regionCode: "CA",
      maxResultCount: 6,
    }),
    signal: AbortSignal.timeout(ADDRESS_SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Google Places returned ${response.status}`);
  const json = (await response.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      addressComponents?: GoogleAddressComponent[];
      location?: { latitude?: number; longitude?: number };
    }>;
  };
  return (json.places ?? []).flatMap((place) => {
    if (!place.formattedAddress) return [];
    const city =
      component(place.addressComponents, "locality") ??
      component(place.addressComponents, "postal_town") ??
      component(place.addressComponents, "administrative_area_level_3");
    const display = place.displayName?.text?.trim() ?? null;
    const streetNumber = component(place.addressComponents, "street_number");
    const route = component(place.addressComponents, "route");
    const street = [streetNumber, route].filter(Boolean).join(" ");
    const buildingName = resolveAddressBuildingName(display, street, place.formattedAddress);
    return [
      {
        address: place.formattedAddress,
        addressLine1: street || place.formattedAddress,
        buildingName,
        municipality: city ? canonicalPermitMunicipality(city) : null,
        province: component(place.addressComponents, "administrative_area_level_1"),
        postalCode: component(place.addressComponents, "postal_code"),
        provider: "google_places" as const,
        placeId: place.id ?? null,
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null,
      },
    ];
  });
}

async function searchOpenStreetMap(query: string): Promise<AddressSearchResult[]> {
  const url =
    "https://photon.komoot.io/api?" +
    new URLSearchParams({
      q: query,
      limit: "6",
      lang: "en",
      lat: "49.25",
      lon: "-123.1",
      bbox: "-139.06,48.2,-114.03,60.0",
    });
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(ADDRESS_SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenStreetMap search returned ${response.status}`);
  const json = (await response.json()) as { features?: any[] };
  return (json.features ?? []).flatMap((feature) => {
    const p = feature.properties ?? {};
    if (p.countrycode !== "CA") return [];
    const line1 = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : (p.street ?? p.name);
    const city = p.city ?? p.district ?? p.county ?? null;
    const address = [line1, city, p.state, p.postcode].filter(Boolean).join(", ");
    if (!line1 || !address) return [];
    return [
      {
        address,
        addressLine1: line1,
        buildingName: p.name && p.name !== line1 ? p.name : null,
        municipality: city ? canonicalPermitMunicipality(city) : null,
        province: p.state ?? null,
        postalCode: p.postcode ?? null,
        provider: "openstreetmap" as const,
        placeId: feature.properties?.osm_id
          ? `${feature.properties?.osm_type ?? "unknown"}:${feature.properties.osm_id}`
          : null,
        latitude: Array.isArray(feature.geometry?.coordinates)
          ? feature.geometry.coordinates[1]
          : null,
        longitude: Array.isArray(feature.geometry?.coordinates)
          ? feature.geometry.coordinates[0]
          : null,
      },
    ];
  });
}

export const searchAddresses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ query: z.string().trim().min(3).max(250) }).parse(data))
  .handler(async ({ data, context }): Promise<AddressSearchResult[]> => {
    const { enforceRateLimit } = await import("./rate-limit.server");
    // Do not attach the address query to metrics. It may contain a full address.
    await enforceRateLimit(context, "address_search");
    const { readServerConfig } = await import("./config.server");
    const config = readServerConfig();
    const key = config.googleMapsApiKey;
    if (key) {
      try {
        return await searchGoogle(data.query, key);
      } catch {
        // A provider outage must not block manual address entry. The fallback is
        // labelled in every result and never confirms municipality or zoning.
      }
    }
    if (config.openStreetMapAddressFallback) return searchOpenStreetMap(data.query);
    throw new Error(
      key
        ? "Address suggestions are temporarily unavailable. Enter the address manually."
        : "Address suggestions require Google Places configuration. Enter the address manually.",
    );
  });
