import { createFileRoute, redirect } from "@tanstack/react-router";

// Scenarios have been merged into the Analysis page.
export const Route = createFileRoute("/_authenticated/scenarios")({
  beforeLoad: () => { throw redirect({ to: "/analysis" }); },
});
