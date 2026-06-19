import { createFileRoute, redirect } from "@tanstack/react-router";

// The project list is now the Deals pipeline.
export const Route = createFileRoute("/_authenticated/projects/")({
  beforeLoad: () => { throw redirect({ to: "/deals" }); },
});
