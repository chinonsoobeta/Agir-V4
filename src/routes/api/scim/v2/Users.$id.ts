import { createFileRoute } from "@tanstack/react-router";
import { handleScimRoute } from "@/lib/scim/route.server";

// SCIM 2.0 /Users/:id resource: get, replace, patch (deactivate), delete.
export const Route = createFileRoute("/api/scim/v2/Users/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleScimRoute(request, ["Users", params.id]),
      PUT: ({ request, params }) => handleScimRoute(request, ["Users", params.id]),
      PATCH: ({ request, params }) => handleScimRoute(request, ["Users", params.id]),
      DELETE: ({ request, params }) => handleScimRoute(request, ["Users", params.id]),
    },
  },
});
