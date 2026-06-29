import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => (
    <WorkspaceProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  ),
  errorComponent: ({ error, reset }) => (
    <WorkspaceProvider>
      <AppShell>
        <div className="px-5 sm:px-8 py-8">
          <Card className="mx-auto max-w-xl p-6 text-center elevated">
            <h1 className="display text-xl font-semibold">This section did not load</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Agir caught the error before it could take down the workspace. Refresh the section or
              open another page from the menu.
            </p>
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown route error"}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={reset}>Try again</Button>
              <Button variant="outline" onClick={() => window.location.assign("/dashboard")}>
                Open dashboard
              </Button>
            </div>
          </Card>
        </div>
      </AppShell>
    </WorkspaceProvider>
  ),
});
