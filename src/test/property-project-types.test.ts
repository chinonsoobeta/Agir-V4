import { describe, expect, it } from "vitest";
import {
  PROPERTY_PROJECT_TYPES,
  propertyProjectTypeLabel,
  propertyProjectTypeOptions,
} from "@/lib/property-project-types";

describe("property project type taxonomy", () => {
  it("uses professional labels for controlled values", () => {
    expect(propertyProjectTypeLabel("tenant_improvement")).toBe("Tenant improvement");
    expect(propertyProjectTypeLabel(null)).toBe("Not categorized");
  });

  it("preserves an unknown existing category during editing", () => {
    const options = propertyProjectTypeOptions("legacy_special_situations");
    expect(options.filter((option) => option.value === "legacy_special_situations")).toEqual([
      {
        value: "legacy_special_situations",
        label: "Existing category: Legacy Special Situations",
      },
    ]);
  });

  it("does not duplicate a controlled current value", () => {
    const options = propertyProjectTypeOptions("acquisition");
    expect(options).toHaveLength(PROPERTY_PROJECT_TYPES.length);
    expect(options.filter((option) => option.value === "acquisition")).toHaveLength(1);
  });
});
