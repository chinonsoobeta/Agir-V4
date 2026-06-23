import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function redirectToApp() {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error) {
        setError(error.message);
        return;
      }

      navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
    }

    redirectToApp();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          AGIR
        </div>
        <h1 className="mt-3 text-2xl font-semibold">Opening deal terminal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ? `Auth check failed: ${error}` : "Checking your session..."}
        </p>
        {error ? (
          <Link
            to="/auth"
            className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
          >
            Go to sign in
          </Link>
        ) : null}
      </div>
    </main>
  );
}
