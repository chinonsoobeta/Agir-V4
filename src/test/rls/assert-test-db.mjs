// Safety guard for the RLS suite. The bootstrap redefines auth.uid() and the
// tests `TRUNCATE auth.users CASCADE` on every case (catastrophic if pointed at
// a real database). Refuse to run unless the target DB name clearly marks it as a
// throwaway test database (contains "test"), or the operator explicitly opts in
// with RLS_ALLOW_DESTRUCTIVE=1.
export function assertTestDatabase(connectionString) {
  if (process.env.RLS_ALLOW_DESTRUCTIVE === "1") return;
  let dbName = "";
  try {
    dbName = new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    dbName = "";
  }
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run the destructive RLS suite against database "${dbName || "(unknown)"}". ` +
        `It TRUNCATEs auth.users and redefines auth.uid(). Point DATABASE_URL at a throwaway ` +
        `database whose name contains "test", or set RLS_ALLOW_DESTRUCTIVE=1 to override.`,
    );
  }
}
