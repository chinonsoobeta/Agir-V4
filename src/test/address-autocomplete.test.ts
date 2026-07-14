import { describe, expect, it } from "vitest";
import {
  formatAddressSuggestion,
  resolveSuggestedMunicipality,
} from "@/components/permits/address-autocomplete";
import {
  canonicalPermitMunicipality,
  isCoveredPermitMunicipality,
  PERMIT_MUNICIPALITIES,
} from "@/lib/permit-municipalities";
import { resolveAddressBuildingName } from "@/lib/address-search.functions";

describe("permit address autocomplete", () => {
  it("formats an address without inventing missing fields", () => {
    expect(
      formatAddressSuggestion({
        housenumber: "453",
        street: "West 12th Avenue",
        city: "Vancouver",
        state: "British Columbia",
        postcode: "V5Y 1V4",
      }),
    ).toBe("453 West 12th Avenue, Vancouver, British Columbia, V5Y 1V4");
    expect(formatAddressSuggestion({ city: "Vancouver" })).toBe("Vancouver");
  });

  it.each([
    ["Vancouver", "City of Vancouver"],
    ["Burnaby", "City of Burnaby"],
    ["Richmond", "City of Richmond"],
    ["Surrey", "City of Surrey"],
    ["Coquitlam", "City of Coquitlam"],
    ["Kelowna", "City of Kelowna"],
    ["North Vancouver District", "District of North Vancouver"],
    ["Langley Township", "Township of Langley"],
    ["Bowen Island", "Bowen Island Municipality"],
  ])("maps pilot city %s to the catalogue name", (city, expected) => {
    expect(resolveSuggestedMunicipality({ city })).toBe(expected);
    expect(canonicalPermitMunicipality(city)).toBe(expected);
  });

  it("accepts canonical catalogue names and leaves unsupported places explicit", () => {
    expect(canonicalPermitMunicipality("City of Vancouver")).toBe("City of Vancouver");
    expect(canonicalPermitMunicipality(" Metro Vancouver ")).toBe("Metro Vancouver");
  });

  it("does not turn a regional district into a pilot municipality", () => {
    expect(resolveSuggestedMunicipality({ county: "Metro Vancouver" })).toBe("Metro Vancouver");
  });

  it("leaves ambiguous city or district labels for explicit confirmation", () => {
    expect(canonicalPermitMunicipality("Langley")).toBe("Langley");
    expect(canonicalPermitMunicipality("North Vancouver")).toBe("North Vancouver");
    expect(isCoveredPermitMunicipality("Langley")).toBe(false);
  });

  it("leaves municipality unknown when the provider supplies none", () => {
    expect(resolveSuggestedMunicipality({ state: "British Columbia" })).toBeNull();
  });

  it("covers all 21 Metro Vancouver municipalities plus Kelowna", () => {
    expect(PERMIT_MUNICIPALITIES).toHaveLength(22);
    expect(new Set(PERMIT_MUNICIPALITIES).size).toBe(22);
    expect(PERMIT_MUNICIPALITIES).toContain("City of Kelowna");
    expect(PERMIT_MUNICIPALITIES).not.toContain("Metro Vancouver");
  });

  it("keeps apartment and complex names separate from the street address", () => {
    expect(
      resolveAddressBuildingName(
        "Harbour Centre",
        "555 West Hastings Street",
        "Harbour Centre, 555 West Hastings Street, Vancouver, BC",
      ),
    ).toBe("Harbour Centre");
    expect(
      resolveAddressBuildingName(
        "555 West Hastings Street",
        "555 West Hastings Street",
        "555 West Hastings Street, Vancouver, BC",
      ),
    ).toBeNull();
  });
});
