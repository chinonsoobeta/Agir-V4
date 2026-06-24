// Staged-deployment safety: newer code may briefly run against an older schema
// (a migration not yet applied). PostgREST surfaces a missing table/relation as
// a schema-cache error rather than throwing: we detect it so callers can fall
// back to defaults instead of crashing the page. Shared by every server
// function that reads a table introduced after the base schema.

export function isMissingRelation(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(
    error &&
    (error.code === "PGRST205" ||
      error.code === "PGRST202" ||
      error.message?.includes("Could not find the table") ||
      error.message?.includes("does not exist") ||
      error.message?.includes("schema cache")),
  );
}

// A column the code writes does not exist yet on the deployed schema (a later
// ALTER TABLE migration has not run). PostgREST reports this as PGRST204 with a
// "Could not find the 'x' column of 'y' in the schema cache" message. Callers
// strip the newer columns and retry so the write still succeeds on old schemas.
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(
    error &&
    (error.code === "PGRST204" || /could not find the '.*' column/i.test(error.message ?? "")),
  );
}
