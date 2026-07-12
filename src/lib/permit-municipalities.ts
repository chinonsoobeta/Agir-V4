/**
 * Canonical names used by the reviewed permit catalogue. These are display
 * labels, not evidence of municipal confirmation or permit applicability.
 */
const PILOT_MUNICIPALITIES: Record<string, string> = {
  burnaby: "City of Burnaby",
  "city of burnaby": "City of Burnaby",
  coquitlam: "City of Coquitlam",
  "city of coquitlam": "City of Coquitlam",
  kelowna: "City of Kelowna",
  "city of kelowna": "City of Kelowna",
  richmond: "City of Richmond",
  "city of richmond": "City of Richmond",
  surrey: "City of Surrey",
  "city of surrey": "City of Surrey",
  vancouver: "City of Vancouver",
  "city of vancouver": "City of Vancouver",
};

export function canonicalPermitMunicipality(value: string | null | undefined) {
  if (!value) return value ?? null;
  return PILOT_MUNICIPALITIES[value.trim().toLowerCase()] ?? value.trim();
}
