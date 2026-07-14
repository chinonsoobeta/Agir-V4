/**
 * Canonical names used by the shared permit research catalogue. These are
 * display labels, not evidence of coverage, confirmation, or applicability.
 */
export const PERMIT_MUNICIPALITIES = [
  "Village of Anmore",
  "Village of Belcarra",
  "Bowen Island Municipality",
  "City of Burnaby",
  "City of Coquitlam",
  "City of Delta",
  "City of Langley",
  "Township of Langley",
  "Village of Lions Bay",
  "City of Maple Ridge",
  "City of New Westminster",
  "City of North Vancouver",
  "District of North Vancouver",
  "City of Pitt Meadows",
  "City of Port Coquitlam",
  "City of Port Moody",
  "City of Richmond",
  "City of Surrey",
  "City of Vancouver",
  "District of West Vancouver",
  "City of White Rock",
  "City of Kelowna",
] as const;

const aliases: Record<string, string> = {
  anmore: "Village of Anmore",
  belcarra: "Village of Belcarra",
  "bowen island": "Bowen Island Municipality",
  burnaby: "City of Burnaby",
  coquitlam: "City of Coquitlam",
  delta: "City of Delta",
  "langley city": "City of Langley",
  "langley township": "Township of Langley",
  "township of langley": "Township of Langley",
  "lions bay": "Village of Lions Bay",
  "maple ridge": "City of Maple Ridge",
  "new westminster": "City of New Westminster",
  "north vancouver city": "City of North Vancouver",
  "north vancouver district": "District of North Vancouver",
  "district of north vancouver": "District of North Vancouver",
  "pitt meadows": "City of Pitt Meadows",
  "port coquitlam": "City of Port Coquitlam",
  "port moody": "City of Port Moody",
  richmond: "City of Richmond",
  surrey: "City of Surrey",
  vancouver: "City of Vancouver",
  "west vancouver": "District of West Vancouver",
  "white rock": "City of White Rock",
  kelowna: "City of Kelowna",
};

const PILOT_MUNICIPALITIES: Record<string, string> = Object.fromEntries([
  ...PERMIT_MUNICIPALITIES.map((name) => [name.toLowerCase(), name]),
  ...Object.entries(aliases),
]);

export function isCoveredPermitMunicipality(value: string | null | undefined): boolean {
  if (!value) return false;
  return Boolean(PILOT_MUNICIPALITIES[value.trim().toLowerCase()]);
}

export function canonicalPermitMunicipality(value: string | null | undefined) {
  if (!value) return value ?? null;
  return PILOT_MUNICIPALITIES[value.trim().toLowerCase()] ?? value.trim();
}
