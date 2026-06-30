import { createFileRoute } from "@tanstack/react-router";
import { handleScimRoute } from "@/lib/scim/route.server";

// SCIM 2.0 /Users collection: list (with userName filter) and create.
export const Route = createFileRoute("/api/scim/v2/Users")({
  server: {
    handlers: {
      GET: ({ request }) => handleScimRoute(request, ["Users"]),
      POST: ({ request }) => handleScimRoute(request, ["Users"]),
    },
  },
});
