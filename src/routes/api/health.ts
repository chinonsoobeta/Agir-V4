import { createFileRoute } from "@tanstack/react-router";
import { checkSchemaDrift } from "@/lib/schema-drift.server";
import { buildHealthChecks } from "@/lib/health.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const schema = await checkSchemaDrift();
        const required = buildHealthChecks(schema);
        const healthy =
          required.supabaseUrl &&
          required.supabaseAnonKey &&
          required.schemaDrift &&
          required.envValid;
        // Public, UNAUTHENTICATED endpoint: return only booleans. The detailed
        // `schema` object (full migration manifest, pending/unreleased versions,
        // the DB connection env-var name, and raw Postgres error text) is
        // reconnaissance material and must not be exposed here. The server logs
        // the detail at startup (see src/server.ts) for operators instead.
        return Response.json(
          {
            status: healthy ? "ok" : "degraded",
            service: "agir",
            timestamp: new Date().toISOString(),
            checks: required,
          },
          {
            status: healthy ? 200 : 503,
            headers: { "cache-control": "no-store" },
          },
        );
      },
    },
  },
});
