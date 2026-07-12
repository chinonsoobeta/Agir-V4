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
  ClipboardCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usePreferences, type TranslationKey } from "@/lib/preferences";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
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
import { createWorkspace, type Workspace } from "@/lib/workspaces.functions";
import { NotificationCenter } from "@/components/notification-center";
import { savePreferenceData } from "@/lib/preferences.functions";
import { getProductAccess } from "@/lib/product-access.functions";

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
    onSuccess: (ws: Workspace) => {
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
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
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
              Property project workspaces let your team share cases, assignments, and decisions.
              You'll be the owner.
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const savePreference = useServerFn(savePreferenceData);
  const getAccess = useServerFn(getProductAccess);
  const access = useQuery({ queryKey: ["product-access"], queryFn: () => getAccess() });
  const isPermitRoute = pathname.startsWith("/permits");
  const isModeNeutralRoute =
    pathname.startsWith("/settings") || pathname.startsWith("/accept-invite");
  const routeMode = isPermitRoute ? "permits" : isModeNeutralRoute ? null : "underwriting";
  const [productMode, setProductMode] = useState<"underwriting" | "permits">(() => {
    if (routeMode) return routeMode;
    if (typeof window !== "undefined") {
      return window.localStorage.getItem("agir-product-mode") === "underwriting"
        ? "underwriting"
        : "permits";
    }
    return "permits";
  });
  const [underwritingAccessOpen, setUnderwritingAccessOpen] = useState(false);

  useEffect(() => {
    if (routeMode) setProductMode(routeMode);
  }, [routeMode]);

  const switchMode = (mode: "underwriting" | "permits") => {
    if (mode === "underwriting" && !access.data?.underwritingPreview) {
      setUnderwritingAccessOpen(true);
      return;
    }
    setProductMode(mode);
    window.localStorage.setItem("agir-product-mode", mode);
    Promise.resolve(savePreference({ data: { key: "productMode", value: mode } })).catch(() => {});
    router.navigate({ to: mode === "permits" ? "/permits" : "/dashboard" });
  };

  const modeSwitch = (
    <div
      className="mt-4 grid grid-cols-2 rounded-lg border border-sidebar-border p-1"
      role="radiogroup"
      aria-label="Agir product mode"
    >
      {(["permits", "underwriting"] as const).map((mode) => (
        <button
          key={mode}
          role="radio"
          aria-checked={productMode === mode}
          onClick={() => switchMode(mode)}
          className={cn(
            "min-h-11 rounded-md px-2 text-xs font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            productMode === mode
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/65 hover:text-sidebar-foreground",
          )}
        >
          {mode === "underwriting" ? (
            <span>
              Underwriting{" "}
              <span className="block text-[10px] uppercase tracking-wide">Preview</span>
            </span>
          ) : (
            "Permits"
          )}
        </button>
      ))}
      <span className="sr-only" aria-live="polite">
        {productMode === "permits" ? "Permits mode active" : "Underwriting Preview mode active"}
      </span>
    </div>
  );

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

  const navigation = (onNavigate?: () => void) => (
    <>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {(productMode === "permits"
          ? [{ to: "/permits", label: "Permit cases", icon: ClipboardCheck }]
          : nav
        ).map((item) => {
          const active = isActive(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "")} />
              {item.label === "Permit cases" ? item.label : t(item.label as TranslationKey)}
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
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="size-4 mr-2" /> : <Moon className="size-4 mr-2" />}
            {theme === "dark" ? t("settings.light") : t("settings.dark")}
          </Button>
        </div>
        <Link
          to="/settings"
          search={{ section: undefined }}
          onClick={onNavigate}
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            pathname.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <Settings
            className={cn("size-4", pathname.startsWith("/settings") ? "text-sidebar-primary" : "")}
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
      <a href="#main-content" className="skip-link">
        {t("shell.skipToContent")}
      </a>
      <aside className="sticky top-0 h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar hidden lg:flex flex-col">
        <div className="px-6 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Building2 className="size-4 text-primary" />
            </div>
            <div>
              <div className="display text-lg font-semibold text-sidebar-foreground leading-none">
                Agir
              </div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground mt-1">
                {t("shell.workspace")}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-1 text-[11px] uppercase tracking-widest text-success">
              <Radio className="size-2.5" />
              {t("shell.live")}
            </div>
            <NotificationCenter />
          </div>
          <WorkspaceSwitcher />
          {modeSwitch}
        </div>
        {navigation()}
      </aside>
      <main id="main-content" className="flex-1 min-w-0 overflow-x-hidden">
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
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label="Open navigation menu"
              >
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-sidebar flex flex-col">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="px-5 py-5 border-b border-sidebar-border">
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
                    <Building2 className="size-4 text-primary" />
                  </div>
                  <div>
                    <div className="display text-xl font-semibold text-sidebar-foreground">
                      Agir
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mt-1">
                      {t("shell.workspace")}
                    </div>
                  </div>
                </div>
                <WorkspaceSwitcher />
                {modeSwitch}
              </div>
              {navigation(() => setMobileNavOpen(false))}
            </SheetContent>
          </Sheet>
        </div>
        {isPermitRoute && !access.data?.permitsAccess ? (
          <div className="px-5 py-10 sm:px-8">
            <Card className="mx-auto max-w-xl p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Professional pilot
              </p>
              <h1 className="mt-2 text-2xl font-semibold">
                {access.isPending ? "Checking pilot access" : "Permit pilot access is required"}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {access.isPending
                  ? "Agir is checking your professional pilot access."
                  : "Agir is using a named professional cohort while catalogue, support, and release evidence is completed."}
              </p>
              <Button className={cn("mt-5", access.isPending && "hidden")} asChild>
                <a href="mailto:support@agir.app?subject=Permit%20pilot%20access">
                  Request pilot access
                </a>
              </Button>
            </Card>
          </div>
        ) : !isPermitRoute && !isModeNeutralRoute && !access.data?.underwritingPreview ? (
          <div className="px-5 py-10 sm:px-8">
            <Card className="mx-auto max-w-xl p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Underwriting Preview
              </p>
              <h1 className="mt-2 text-2xl font-semibold">
                {access.isPending ? "Checking access" : "Access is limited during the pilot"}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {access.isPending
                  ? "Agir is checking your Underwriting Preview entitlement."
                  : "Underwriting is available only to explicitly approved users. Permit research and workflow remains available without an underwriting project."}
              </p>
              <div className={cn("mt-5 flex flex-wrap gap-2", access.isPending && "hidden")}>
                <Button onClick={() => switchMode("permits")}>Open Permits</Button>
                <Button variant="outline" asChild>
                  <a href="mailto:support@agir.app?subject=Underwriting%20Preview%20access">
                    Request access
                  </a>
                </Button>
              </div>
            </Card>
          </div>
        ) : (
          children
        )}
      </main>
      <Dialog open={underwritingAccessOpen} onOpenChange={setUnderwritingAccessOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Underwriting Preview access</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-6 text-muted-foreground">
            Underwriting is visible as a Preview but is limited to approved pilot users. You can
            continue permit work without it.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnderwritingAccessOpen(false)}>
              Stay in Permits
            </Button>
            <Button asChild>
              <a href="mailto:support@agir.app?subject=Underwriting%20Preview%20access">
                Request access
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      <div className="px-5 sm:px-8 py-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-1.5">
              {eyebrow}
            </div>
          )}
          <h1 className="display text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">{actions}</div>
        )}
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
