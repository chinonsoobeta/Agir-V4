import { createFileRoute } from "@tanstack/react-router";
import { checkSchemaDrift } from "@/lib/schema-drift.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const schema = await checkSchemaDrift();
        const required = {
          supabaseUrl: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
          supabaseAnonKey: Boolean(
            process.env.SUPABASE_ANON_KEY ||
            process.env.SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            process.env.VITE_SUPABASE_ANON_KEY ||
            process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          ),
          schemaDrift: schema.status !== "drift",
        };
        const healthy = Object.values(required).every(Boolean);
        return Response.json(
          {
            status: healthy ? "ok" : "degraded",
            service: "agir",
            timestamp: new Date().toISOString(),
            checks: required,
            schema,
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
