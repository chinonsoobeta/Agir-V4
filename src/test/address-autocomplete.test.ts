import { describe, expect, it } from "vitest";
import {
  formatAddressSuggestion,
  resolveSuggestedMunicipality,
} from "@/components/permits/address-autocomplete";
import { canonicalPermitMunicipality } from "@/lib/permit-municipalities";

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

  it("leaves municipality unknown when the provider supplies none", () => {
    expect(resolveSuggestedMunicipality({ state: "British Columbia" })).toBeNull();
  });
});
