import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { usePreferences, type AppLanguage, type AppTheme } from "@/lib/preferences";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Monitor, Languages } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Agir" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const { t, theme, setTheme, language, setLanguage } = usePreferences();
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email ?? "");
      if (data.user) {
        const { data: r } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id);
        setRoles((r ?? []).map((x: any) => x.role));
      }
    });
  }, []);

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div className="p-6 space-y-4 max-w-3xl">
        <Card className="p-5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            {t("settings.account")}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Email</div>
              <div className="num">{email}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Roles</div>
              <div className="capitalize">{roles.join(", ") || "—"}</div>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            {t("settings.appearance")}
          </div>
          <div className="mt-4 space-y-5">
            <PreferenceRow label={t("settings.theme")}>
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
            </PreferenceRow>
            <PreferenceRow label={t("settings.language")}>
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
            </PreferenceRow>
          </div>
        </Card>
      </div>
    </>
  );
}

function PreferenceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
