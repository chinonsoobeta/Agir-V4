import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutGrid, Layers, Gavel, FileText, LineChart, FileBarChart, Bot, Settings, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/portfolio", label: "Portfolio", icon: LayoutGrid },
  { to: "/deals", label: "Deals", icon: Layers },
  { to: "/committee", label: "Investment Committee", icon: Gavel },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/analysis", label: "Analysis", icon: LineChart },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/copilot", label: "Copilot", icon: Bot },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  const isActive = (to: string) => {
    if (to === "/deals") return pathname.startsWith("/deals") || pathname.startsWith("/projects");
    return pathname.startsWith(to);
  };

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="sticky top-0 h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="px-6 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <span className="display text-primary text-base font-semibold">A</span>
            </div>
            <div>
              <div className="display text-lg font-semibold tracking-tight text-sidebar-foreground leading-none">Agir</div>
              <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mt-1">Investment Decisions</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {nav.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}>
                <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-0.5">
          <Link to="/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              pathname.startsWith("/settings")
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}>
            <Settings className={cn("size-4", pathname.startsWith("/settings") ? "text-primary" : "")} /> Settings
          </Link>
          <Button onClick={signOut} variant="ghost" size="sm" className="w-full justify-start gap-3 px-3 text-sidebar-foreground/65 hover:text-sidebar-foreground">
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}

export function PageHeader({ title, subtitle, eyebrow, actions }: { title: string; subtitle?: string; eyebrow?: string; actions?: React.ReactNode }) {
  return (
    <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
      <div className="px-8 py-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-1.5">{eyebrow}</div>}
          <h1 className="display text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      </div>
    </header>
  );
}
