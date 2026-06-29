import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  LayoutGrid,
  Layers,
  Gavel,
  FileText,
  LineChart,
  FileBarChart,
  Bot,
  Settings,
  LogOut,
  Workflow,
  Radar,
  Plug,
  Menu,
  Radio,
  GitCompareArrows,
  ChevronsUpDown,
  Check,
  Plus,
  Building2,
  Users,
  ContactRound,
  Sun,
  Moon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usePreferences, type TranslationKey } from "@/lib/preferences";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/workspace-context";
import { createWorkspace } from "@/lib/workspaces.functions";
import { NotificationCenter } from "@/components/notification-center";

const nav = [
  { to: "/dashboard", label: "nav.home", icon: LayoutDashboard },
  { to: "/portfolio", label: "nav.portfolio", icon: LayoutGrid },
  { to: "/deals", label: "nav.deals", icon: Layers },
  { to: "/relationships", label: "nav.relationships", icon: ContactRound },
  { to: "/compare", label: "nav.compare", icon: GitCompareArrows },
  { to: "/execution", label: "nav.execution", icon: Workflow },
  { to: "/markets", label: "nav.markets", icon: Radar },
  { to: "/committee", label: "nav.committee", icon: Gavel },
  { to: "/documents", label: "nav.documents", icon: FileText },
  { to: "/analysis", label: "nav.analysis", icon: LineChart },
  { to: "/reports", label: "nav.reports", icon: FileBarChart },
  { to: "/integrations", label: "nav.integrations", icon: Plug },
  { to: "/copilot", label: "nav.copilot", icon: Bot },
] as const;

function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, setActiveWorkspace, refetch } = useWorkspace();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const createFn = useServerFn(createWorkspace);
  const create = useMutation({
    mutationFn: () => createFn({ data: { name: name.trim() } }),
    onSuccess: (ws: any) => {
      setCreateOpen(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      refetch();
      if (ws?.id) setActiveWorkspace(ws.id);
      toast.success(`Created “${ws?.name ?? "workspace"}”`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="mt-3 flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent">
            <div className="size-6 rounded bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <Building2 className="size-3.5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate text-sidebar-foreground">
                {activeWorkspace?.name ?? "Personal workspace"}
              </div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                {activeWorkspace?.role ?? "owner"}
              </div>
            </div>
            <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => setActiveWorkspace(w.id)}>
              <Building2 className="size-3.5 mr-2 text-muted-foreground" />
              <span className="flex-1 truncate">{w.name}</span>
              {activeWorkspace?.id === w.id && <Check className="size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5 mr-2" /> Create workspace
          </DropdownMenuItem>
          <Link to="/settings" search={{ section: "team" }}>
            <DropdownMenuItem>
              <Users className="size-3.5 mr-2" /> Manage team
            </DropdownMenuItem>
          </Link>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Workspace name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Capital Partners"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) create.mutate();
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Workspaces let your team share deals, assignments and decisions. You'll be the owner.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t, theme, setTheme } = usePreferences();

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

  const navigation = (
    <>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {nav.map((item) => {
          const active = isActive(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "")} />
              {t(item.label as TranslationKey)}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-sidebar-border space-y-0.5">
        <div className="mb-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-3 text-sidebar-foreground/65"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="size-4 mr-2" /> : <Moon className="size-4 mr-2" />}
            {theme === "dark" ? t("settings.light") : t("settings.dark")}
          </Button>
        </div>
        <Link
          to="/settings"
          search={{ section: undefined }}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
            pathname.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <Settings
            className={cn("size-4", pathname.startsWith("/settings") ? "text-primary" : "")}
          />{" "}
          {t("nav.settings")}
        </Link>
        <Button
          onClick={signOut}
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 px-3 text-sidebar-foreground/65 hover:text-sidebar-foreground"
        >
          <LogOut className="size-4" /> {t("nav.signOut")}
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="sticky top-0 h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar hidden lg:flex flex-col">
        <div className="px-6 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Building2 className="size-4 text-primary" />
            </div>
            <div>
              <div className="display text-lg font-semibold tracking-tight text-sidebar-foreground leading-none">
                Agir
              </div>
              <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mt-1">
                {t("shell.workspace")}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-1 text-[9px] uppercase tracking-widest text-success">
              <Radio className="size-2.5" />
              {t("shell.live")}
            </div>
            <NotificationCenter />
          </div>
          <WorkspaceSwitcher />
        </div>
        {navigation}
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="lg:hidden sticky top-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur flex items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Building2 className="size-4 text-primary" />
            </div>
            <div className="display text-lg font-semibold">Agir</div>
          </div>
          <div className="ml-auto mr-2">
            <NotificationCenter />
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-sidebar flex flex-col">
              <div className="px-5 py-5 border-b border-sidebar-border">
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
                    <Building2 className="size-4 text-primary" />
                  </div>
                  <div>
                    <div className="display text-xl font-semibold text-sidebar-foreground">
                      Agir
                    </div>
                    <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mt-1">
                      {t("shell.workspace")}
                    </div>
                  </div>
                </div>
                <WorkspaceSwitcher />
              </div>
              {navigation}
            </SheetContent>
          </Sheet>
        </div>
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
      <div className="px-5 sm:px-8 py-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-1.5">
              {eyebrow}
            </div>
          )}
          <h1 className="display text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      </div>
    </header>
  );
}

/**
 * Standard page content wrapper. Owns the horizontal gutters and vertical
 * rhythm so every route lines up with the PageHeader above it. Pass a
 * className to override spacing for special layouts (e.g. flex + gap).
 */
export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 sm:px-8 py-6 space-y-6", className)}>{children}</div>;
}
