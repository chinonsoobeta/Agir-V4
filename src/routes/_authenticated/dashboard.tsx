import { createFileRoute, redirect } from "@tanstack/react-router";

// The dashboard has been replaced by the Portfolio decision view.
export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: () => { throw redirect({ to: "/portfolio" }); },
});
