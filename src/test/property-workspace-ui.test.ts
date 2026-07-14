import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  activityLabel,
  propertyAddress,
  propertyPrice,
  propertyTitle,
} from "@/lib/property-presentation";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

describe("property workspace presentation", () => {
  test("keeps the building, address line 2, and unit distinct", () => {
    const property = {
      building_name: "Harbour Centre",
      address_line_1: "555 West Hastings Street",
      address_line_2: "North Tower",
      unit: "1204",
      municipality: "Vancouver",
      region: "BC",
      postal_code: "V6B 4N6",
    };

    expect(propertyTitle(property)).toBe("Harbour Centre");
    expect(propertyAddress(property)).toBe(
      "555 West Hastings Street, North Tower · Unit 1204, Vancouver, BC, V6B 4N6",
    );
  });

  test("formats optional commercial facts without inventing values", () => {
    expect(propertyPrice({ price: null })).toBe("Not recorded");
    expect(propertyPrice({ price: 25_000_000, currency: "CAD" })).toContain("25,000,000");
  });

  test("turns immutable event codes into plain language", () => {
    expect(activityLabel("property_tasks_insert")).toBe("Task created");
    expect(activityLabel("permit_cases_linked")).toBe("Permit case linked");
  });

  test("the shared route exposes fragment search, structured filters, and history", () => {
    const list = read("src/routes/_authenticated/properties.index.tsx");
    const detail = read("src/routes/_authenticated/properties.$propertyId.tsx");
    const editor = read("src/components/properties/property-editor.tsx");
    const shell = read("src/components/app-shell.tsx");

    for (const field of ["query", "municipality", "project_type", "min_price", "max_price"]) {
      expect(list).toContain(field);
    }
    expect(list).toContain("Search property history");
    expect(list).toContain("Historical match");
    expect(detail).toContain("An immutable record of what changed");
    expect(detail).toContain("Load older events");
    expect(detail).toContain("listPropertyActivity");
    expect(detail).toContain("Files & contacts");
    expect(editor).toContain("AddressAutocomplete");
    expect(editor).toContain("address_line_2");
    expect(editor).toContain("provider_place_id");
    expect(shell).toContain('pathname.startsWith("/properties")');
    expect(shell.match(/to: "\/properties"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
