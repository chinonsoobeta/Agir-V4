import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { usePreferences, type AppLanguage, type AppTheme } from "@/lib/preferences";
import { useWorkspace } from "@/lib/workspace-context";
import { getMyProfile, updateMyProfile } from "@/lib/account.functions";
import {
  getPreferenceData,
  savePreferenceData,
  setOnboardingDismissed,
} from "@/lib/preferences.functions";
import {
  listWorkspaceMembers,
  listWorkspaceInvitations,
  inviteWorkspaceMember,
  updateMemberRole,
  removeMember,
  createWorkspace,
  PERSONAL_WORKSPACE_ID,
  type WorkspaceRole,
} from "@/lib/workspaces.functions";
import { getWorkspaceGovernance, saveWorkspaceGovernance } from "@/lib/operating-depth.functions";
import {
  User,
  Lock,
  Palette,
  Bell,
  Users,
  ShieldCheck,
  Info,
  Moon,
  Sun,
  Monitor,
  Languages,
  Rocket,
  LogOut,
  Save,
  Mail,
  Copy,
  Trash2,
  UserPlus,
  Building2,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "account", label: "Account & security", icon: Lock },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "team", label: "Team & members", icon: Users },
  { id: "governance", label: "Governance", icon: Landmark },
  { id: "data", label: "Data & privacy", icon: ShieldCheck },
  { id: "about", label: "About & help", icon: Info },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings | Agir" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    section: typeof s.section === "string" ? s.section : undefined,
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { section } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = usePreferences();
  const active: SectionId = (SECTIONS.find((s) => s.id === section)?.id ?? "profile") as SectionId;

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div className="p-5 md:p-6 flex flex-col lg:flex-row gap-6 max-w-5xl">
        {/* Section nav */}
        <nav className="lg:w-56 shrink-0 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const on = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => navigate({ to: "/settings", search: { section: s.id } })}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors min-h-[40px]",
                  on
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4 shrink-0", on && "text-primary")} />
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-4">
          {active === "profile" && <ProfileSection />}
          {active === "account" && <AccountSection />}
          {active === "appearance" && <AppearanceSection />}
          {active === "notifications" && <NotificationsSection />}
          {active === "team" && <TeamSection />}
          {active === "governance" && <GovernanceSection />}
          {active === "data" && <DataSection />}
          {active === "about" && <AboutSection />}
        </div>
      </div>
    </>
  );
}

function GovernanceSection() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.personal ? null : activeWorkspace?.id;
  const canManage = activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const query = useQuery({
    queryKey: ["workspace-governance", workspaceId],
    queryFn: () => getWorkspaceGovernance({ data: { workspace_id: workspaceId! } }),
    enabled: Boolean(workspaceId),
  });
  const saveFn = useServerFn(saveWorkspaceGovernance);
  const [threshold, setThreshold] = useState("");
  const [twoPerson, setTwoPerson] = useState(false);
  const [domains, setDomains] = useState("");
  const [retention, setRetention] = useState("2555");
  useEffect(() => {
    if (!query.data) return;
    setThreshold(
      query.data.approval_threshold == null ? "" : String(query.data.approval_threshold),
    );
    setTwoPerson(Boolean(query.data.require_two_person_approval));
    setDomains((query.data.allowed_email_domains ?? []).join(", "));
    setRetention(String(query.data.data_retention_days ?? 2555));
  }, [query.data]);
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          workspace_id: workspaceId!,
          approval_threshold: threshold ? Number(threshold) : null,
          require_two_person_approval: twoPerson,
          allowed_email_domains: domains
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
          data_retention_days: Number(retention),
        },
      }),
    onSuccess: () => {
      query.refetch();
      toast.success("Governance settings saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!workspaceId) {
    return (
      <SectionCard
        title="Workspace governance"
        description="Create or select a shared workspace to configure institutional controls."
      >
        <p className="text-sm text-muted-foreground">
          Personal workspaces use owner-only controls and do not require an approval policy.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Workspace governance"
      description="Set approval, access, and retention controls for this workspace."
    >
      <div className="space-y-5 max-w-xl">
        <div>
          <Label>Capital approval threshold</Label>
          <Input
            type="number"
            min="0"
            value={threshold}
            disabled={!canManage}
            onChange={(event) => setThreshold(event.target.value)}
            placeholder="Example: 10000000"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Deals at or above this amount should receive the workspace's formal approval process.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Two-person approval</div>
            <div className="text-xs text-muted-foreground">
              Require independent review before high-value decisions are finalized.
            </div>
          </div>
          <Switch checked={twoPerson} disabled={!canManage} onCheckedChange={setTwoPerson} />
        </div>
        <div>
          <Label>Allowed email domains</Label>
          <Input
            value={domains}
            disabled={!canManage}
            onChange={(event) => setDomains(event.target.value)}
            placeholder="firm.com, advisor.com"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Comma-separated domains for invitation governance. Leave blank for no restriction.
          </p>
        </div>
        <div>
          <Label>Data retention, days</Label>
          <Input
            type="number"
            min="30"
            max="36500"
            value={retention}
            disabled={!canManage}
            onChange={(event) => setRetention(event.target.value)}
          />
        </div>
        {canManage ? (
          <Button disabled={save.isPending || Number(retention) < 30} onClick={() => save.mutate()}>
            <Save className="size-4 mr-1.5" />
            Save governance
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only workspace owners and administrators can change these controls.
          </p>
        )}
      </div>
    </SectionCard>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function initials(name: string | null, email: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  return (
    ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src[0]?.toUpperCase() || "?"
  );
}

// ---- Profile ----
function ProfileSection() {
  const qc = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ["my-profile"], queryFn: () => getMyProfile() });
  const updateFn = useServerFn(updateMyProfile);
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setAvatarUrl(profile.avatar_url ?? "");
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: () => updateFn({ data: { full_name: fullName, avatar_url: avatarUrl } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Profile updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SectionCard title="Profile" description="How you appear to your team across Agir.">
      <div className="flex items-center gap-4 mb-5">
        <Avatar className="size-16">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName} />}
          <AvatarFallback className="text-lg">
            {initials(fullName, profile?.email ?? null)}
          </AvatarFallback>
        </Avatar>
        <div className="text-sm text-muted-foreground">
          <div className="font-medium text-foreground">{fullName || "Unnamed"}</div>
          <div className="num">{profile?.email}</div>
        </div>
      </div>
      <div className="space-y-4 max-w-md">
        <div>
          <Label>Full name</Label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Analyst"
          />
        </div>
        <div>
          <Label>Avatar URL</Label>
          <Input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Paste an image URL. Leave blank to use your initials.
          </p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="size-4 mr-1.5" />
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </SectionCard>
  );
}

// ---- Account & security ----
function AccountSection() {
  const navigate = useNavigate();
  const { data: profile } = useQuery({ queryKey: ["my-profile"], queryFn: () => getMyProfile() });
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePassword() {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== pw2) return toast.error("Passwords do not match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    setPw("");
    setPw2("");
    toast.success("Password updated");
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <>
      <SectionCard title="Account" description="Your sign-in identity and role.">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Email</div>
            <div className="num">{profile?.email ?? "Not available"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Roles</div>
            <div className="flex flex-wrap gap-1.5">
              {(profile?.roles ?? []).length ? (
                profile!.roles.map((r) => (
                  <Badge key={r} variant="secondary" className="capitalize">
                    {r}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Change password" description="Use at least 8 characters.">
        <div className="space-y-3 max-w-md">
          <div>
            <Label>New password</Label>
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label>Confirm password</Label>
            <Input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button variant="outline" onClick={changePassword} disabled={busy || !pw}>
            <Lock className="size-4 mr-1.5" />
            {busy ? "Updating…" : "Update password"}
          </Button>
        </div>
      </SectionCard>

      <Card className="p-5 border-destructive/30">
        <h2 className="text-base font-semibold">Sign out</h2>
        <p className="text-sm text-muted-foreground mt-0.5 mb-3">
          End your session on this device.
        </p>
        <Button
          variant="outline"
          onClick={signOut}
          className="text-destructive hover:text-destructive"
        >
          <LogOut className="size-4 mr-1.5" /> Sign out
        </Button>
      </Card>
    </>
  );
}

// ---- Appearance ----
function AppearanceSection() {
  const { t, theme, setTheme, language, setLanguage } = usePreferences();
  return (
    <SectionCard
      title={t("settings.appearance")}
      description="Theme and language. Saved to this browser."
    >
      <div className="space-y-5">
        <div>
          <div className="text-xs text-muted-foreground mb-2">{t("settings.theme")}</div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["light", t("settings.light"), Sun],
                ["dark", t("settings.dark"), Moon],
                ["system", t("settings.system"), Monitor],
              ] as const
            ).map(([value, label, Icon]) => (
              <Button
                key={value}
                size="sm"
                variant={theme === value ? "default" : "outline"}
                onClick={() => setTheme(value as AppTheme)}
              >
                <Icon className="size-3.5 mr-1.5" />
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-2">{t("settings.language")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Languages className="size-4 text-muted-foreground" />
            {(
              [
                ["en", t("settings.english")],
                ["fr", t("settings.french")],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={language === value ? "default" : "outline"}
                onClick={() => setLanguage(value as AppLanguage)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ---- Notifications ----
const NOTIFICATION_OPTIONS = [
  {
    key: "overdueMilestones",
    label: "Overdue milestones",
    help: "Flag execution items past their due date.",
  },
  {
    key: "staleDeals",
    label: "Stale deals",
    help: "Surface active deals with no update in 14 days.",
  },
  {
    key: "decisionsNeeded",
    label: "Decisions needed",
    help: "Highlight deals waiting on a committee decision.",
  },
  { key: "weeklyDigest", label: "Weekly digest", help: "A weekly pipeline + attention summary." },
] as const;
const NOTIFICATION_DEFAULTS: Record<string, boolean> = {
  overdueMilestones: true,
  staleDeals: true,
  decisionsNeeded: true,
  weeklyDigest: false,
};

function NotificationsSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pref-data"], queryFn: () => getPreferenceData() });
  const saveFn = useServerFn(savePreferenceData);
  const prefs = {
    ...NOTIFICATION_DEFAULTS,
    ...((data?.notifications as Record<string, boolean>) ?? {}),
  };

  const save = useMutation({
    mutationFn: (next: Record<string, boolean>) =>
      saveFn({ data: { key: "notifications", value: next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pref-data"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SectionCard
      title="Notifications"
      description="Tune which signals surface in your in-product attention queue."
    >
      <div className="space-y-1 divide-y divide-border">
        {NOTIFICATION_OPTIONS.map((opt) => (
          <div key={opt.key} className="flex items-center justify-between gap-4 py-3 first:pt-0">
            <div className="min-w-0">
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-xs text-muted-foreground">{opt.help}</div>
            </div>
            <Switch
              checked={prefs[opt.key]}
              onCheckedChange={(v) => save.mutate({ ...prefs, [opt.key]: v })}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        These control in-product surfacing today. Email / Slack delivery is on the roadmap and will
        reuse these preferences.
      </p>
    </SectionCard>
  );
}

// ---- Team & members ----
const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

function TeamSection() {
  const qc = useQueryClient();
  const { activeWorkspace, setActiveWorkspace, refetch } = useWorkspace();
  const wsId = activeWorkspace?.id ?? PERSONAL_WORKSPACE_ID;
  const isPersonal = !activeWorkspace || activeWorkspace.personal || wsId === PERSONAL_WORKSPACE_ID;
  const canManage = activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";

  const createFn = useServerFn(createWorkspace);
  const [newWs, setNewWs] = useState("");
  const create = useMutation({
    mutationFn: () => createFn({ data: { name: newWs.trim() } }),
    onSuccess: (ws: any) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      refetch();
      if (ws?.id) setActiveWorkspace(ws.id);
      setNewWs("");
      toast.success("Workspace created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: members = [] } = useQuery({
    queryKey: ["ws-members", wsId],
    queryFn: () => listWorkspaceMembers({ data: { workspace_id: wsId } }),
  });
  const { data: invites = [] } = useQuery({
    queryKey: ["ws-invites", wsId],
    queryFn: () => listWorkspaceInvitations({ data: { workspace_id: wsId } }),
    enabled: !isPersonal,
  });

  const inviteFn = useServerFn(inviteWorkspaceMember);
  const roleFn = useServerFn(updateMemberRole);
  const removeFn = useServerFn(removeMember);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");

  const invite = useMutation({
    mutationFn: () =>
      inviteFn({ data: { workspace_id: wsId, email: email.trim(), role: inviteRole } }),
    onSuccess: (inv: any) => {
      qc.invalidateQueries({ queryKey: ["ws-invites", wsId] });
      setEmail("");
      const link = inv?.token ? `${window.location.origin}/accept-invite?token=${inv.token}` : null;
      if (link) {
        navigator.clipboard?.writeText(link).catch(() => {});
        toast.success("Invite created: link copied to clipboard");
      } else {
        toast.success("Invitation sent");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const changeRole = useMutation({
    mutationFn: (v: { id: string; role: WorkspaceRole }) =>
      roleFn({ data: { member_id: v.id, role: v.role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-members", wsId] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { member_id: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-members", wsId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isPersonal) {
    return (
      <SectionCard
        title="Team & members"
        description="You're in a personal workspace. Create a shared workspace to invite teammates, assign deals, and coordinate."
      >
        <div className="flex flex-wrap items-end gap-3 max-w-md">
          <div className="flex-1 min-w-[12rem]">
            <Label>Workspace name</Label>
            <Input
              value={newWs}
              onChange={(e) => setNewWs(e.target.value)}
              placeholder="Acme Capital Partners"
            />
          </div>
          <Button onClick={() => create.mutate()} disabled={!newWs.trim() || create.isPending}>
            <Building2 className="size-4 mr-1.5" />
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard
        title={`${activeWorkspace?.name} · members`}
        description="People who can see and work on this workspace's deals."
      >
        <div className="space-y-1 divide-y divide-border">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-2.5 first:pt-0">
              <Avatar className="size-8">
                <AvatarFallback className="text-xs">
                  {initials(m.full_name, m.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {m.full_name || m.email || "Member"}
                  {m.isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                </div>
                {m.full_name && (
                  <div className="text-xs text-muted-foreground num truncate">{m.email}</div>
                )}
              </div>
              {canManage && !m.isSelf ? (
                <Select
                  value={m.role}
                  onValueChange={(r) => changeRole.mutate({ id: m.id, role: r as WorkspaceRole })}
                >
                  <SelectTrigger className="h-8 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="secondary" className="capitalize">
                  {m.role}
                </Badge>
              )}
              {canManage && !m.isSelf && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => remove.mutate(m.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {canManage && (
        <SectionCard
          title="Invite a teammate"
          description="They'll get a link to join this workspace."
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[14rem]">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@firm.com"
              />
            </div>
            <Select value={inviteRole} onValueChange={(r) => setInviteRole(r as WorkspaceRole)}>
              <SelectTrigger className="h-9 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.filter((r) => r !== "owner").map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => invite.mutate()} disabled={!email.trim() || invite.isPending}>
              <UserPlus className="size-4 mr-1.5" />
              {invite.isPending ? "Inviting…" : "Invite"}
            </Button>
          </div>

          {invites.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                Pending invitations
              </div>
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 text-sm">
                    <Mail className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="num truncate flex-1">{inv.email}</span>
                    <Badge variant="secondary" className="capitalize">
                      {inv.role}
                    </Badge>
                    {inv.token && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        title="Copy invite link"
                        onClick={() => {
                          navigator.clipboard?.writeText(
                            `${window.location.origin}/accept-invite?token=${inv.token}`,
                          );
                          toast.success("Invite link copied");
                        }}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>
      )}
    </>
  );
}

// ---- Data & privacy ----
function DataSection() {
  const navigate = useNavigate();
  return (
    <>
      <SectionCard title="Determinism & provenance" description="How Agir handles your numbers.">
        <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
          <li>
            Every financial figure traces to an approved input, a documented assumption, or a
            deterministic calculation.
          </li>
          <li>
            AI may explain, classify, or summarize. It never invents or overrides a financial value.
          </li>
          <li>
            Missing or conflicting required inputs fail closed: underwriting will not run on
            guesses.
          </li>
          <li>Every run, decision and assumption change is written to an immutable audit log.</li>
        </ul>
      </SectionCard>
      <SectionCard
        title="Exports"
        description="Export clean, typed data with its supporting traceability."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/reports", search: { project: undefined } })}
          >
            Portfolio reports (CSV / Excel / PDF)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/compare", search: { deals: undefined } })}
          >
            Deal comparison
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Excel exports use real numeric cells (no screenshots). Audit trails are exportable per
          deal from the deal timeline.
        </p>
      </SectionCard>
    </>
  );
}

// ---- About & help ----
function AboutSection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const resumeFn = useServerFn(setOnboardingDismissed);
  async function resumeOnboarding() {
    if (typeof window !== "undefined") window.localStorage.removeItem("agir-onboarding-dismissed");
    try {
      await resumeFn({ data: { dismissed: false } });
    } catch {
      /* preferences table may be unavailable */
    }
    qc.invalidateQueries({ queryKey: ["onboarding"] });
    toast.success("Setup checklist restored");
    navigate({ to: "/dashboard" });
  }
  return (
    <>
      <SectionCard title="Getting started" description="Revisit the guided setup any time.">
        <Button size="sm" variant="outline" onClick={resumeOnboarding}>
          <Rocket className="size-3.5 mr-1.5" /> Restart setup checklist
        </Button>
      </SectionCard>
      <SectionCard
        title="About Agir"
        description="A transparent, deterministic real-estate investment operating system."
      >
        <div className="text-sm text-muted-foreground space-y-1">
          <div>
            Agir pairs an institutional pipeline, reporting and execution layer with a deterministic
            underwriting engine.
          </div>
          <div>
            Documentation and setup guidance ship in-product; no consulting engagement is required
            to operate it.
          </div>
        </div>
      </SectionCard>
    </>
  );
}
