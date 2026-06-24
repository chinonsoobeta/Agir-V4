import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { PreferencesProvider, usePreferences } from "@/lib/preferences";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="font-mono text-xs text-muted-foreground tracking-widest">ERR / 404</div>
        <h1 className="mt-2 text-3xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Go home
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="font-mono text-xs text-destructive tracking-widest">ERR / RUNTIME</div>
        <h1 className="mt-2 text-xl font-semibold">Something broke</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agir | Real estate investment decisions, made clear" },
      {
        name: "description",
        content:
          "Agir brings deal flow, deterministic underwriting, investment decisions, execution, and portfolio reporting into one clear workspace.",
      },
      { property: "og:title", content: "Agir | Real estate investment decisions, made clear" },
      {
        property: "og:description",
        content:
          "Move from source to close with traceable numbers, a live pipeline, and a shared record of every decision.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Applied synchronously in <head> before first paint so the stored theme +
// language are in place with no flash of the wrong palette. Mirrors the
// resolution logic in preferences.tsx (default dark, honour "system").
const NO_FLASH_THEME = `(function(){try{
  var t=localStorage.getItem('agir-theme')||'dark';
  var sysDark=window.matchMedia('(prefers-color-scheme: dark)').matches;
  var r=t==='system'?(sysDark?'dark':'light'):t;
  var el=document.documentElement;
  el.classList.add(r);el.style.colorScheme=r;
  var l=localStorage.getItem('agir-language');if(l==='fr'||l==='en')el.lang=l;
}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (event === "SIGNED_OUT") queryClient.clear();
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <Outlet />
        <AppToaster />
      </PreferencesProvider>
    </QueryClientProvider>
  );
}

function AppToaster() {
  const { resolvedTheme } = usePreferences();
  return <Toaster theme={resolvedTheme} />;
}
