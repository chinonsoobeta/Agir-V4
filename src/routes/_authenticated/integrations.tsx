import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listIntegrations, setIntegration } from "@/lib/operations.functions";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  Building2,
  Check,
  Cloud,
  Database,
  FileSpreadsheet,
  Plug,
  RefreshCw,
  Unplug,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";

const integrationsQ = queryOptions({
  queryKey: ["integrations"],
  queryFn: () => listIntegrations(),
});
const CATALOG = [
  {
    provider: "salesforce",
    name: "Salesforce",
    category: "CRM",
    icon: Cloud,
    description: "Sync opportunities, owners, contacts and pipeline stages.",
  },
  {
    provider: "dealcloud",
    name: "DealCloud",
    category: "CRM",
    icon: Building2,
    description: "Bring deal sourcing and relationship intelligence into Agir.",
  },
  {
    provider: "snowflake",
    name: "Snowflake",
    category: "Data warehouse",
    icon: Database,
    description: "Connect governed market, portfolio and operating datasets.",
  },
  {
    provider: "microsoft-365",
    name: "Microsoft 365",
    category: "Documents",
    icon: FileSpreadsheet,
    description: "Import Excel models and publish committee-ready outputs.",
  },
  {
    provider: "webhooks",
    name: "Webhooks & API",
    category: "Developer",
    icon: Webhook,
    description: "Push decisions and receive updates from your internal stack.",
  },
] as const;

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({ meta: [{ title: "Integrations | Agir" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(integrationsQ),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { data: connections } = useSuspenseQuery(integrationsQ);
  const fn = useServerFn(setIntegration);
  const qc = useQueryClient();
  useRealtimeRefresh();
  const mutation = useMutation({
    mutationFn: (data: any) => fn({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Integration updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const byProvider = new Map(
    connections.map((connection: any) => [connection.provider, connection]),
  );

  return (
    <>
      <PageHeader
        eyebrow="Connected systems"
        title="Integrations"
        subtitle="See what is connected, when it last synced, and whether it needs attention."
      />
      <div className="p-5 md:p-8 space-y-6">
        <Card className="p-5 elevated bg-primary/[0.04]">
          <div className="flex items-start gap-3">
            <Plug className="size-5 text-primary mt-0.5" />
            <div>
              <div className="font-semibold">Financial logic stays inside Agir</div>
              <p className="text-sm text-muted-foreground mt-1">
                Connected tools can supply records and documents. Agir still calculates every
                financial result from approved assumptions.
              </p>
            </div>
          </div>
        </Card>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {CATALOG.map((app) => {
            const connection: any = byProvider.get(app.provider);
            const connected = connection?.status === "connected";
            const Icon = app.icon;
            return (
              <Card key={app.provider} className="p-5 flex flex-col elevated">
                <div className="flex items-start justify-between gap-3">
                  <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      connected
                        ? "text-success border-success/30 bg-success/5"
                        : "text-muted-foreground"
                    }
                  >
                    {connected ? <Check className="size-3 mr-1" /> : null}
                    {connected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                <div className="font-semibold mt-4">{app.name}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                  {app.category}
                </div>
                <p className="text-sm text-muted-foreground mt-3 flex-1">{app.description}</p>
                {connection?.last_synced_at && (
                  <div className="text-[10px] text-muted-foreground mt-4">
                    Last sync {new Date(connection.last_synced_at).toLocaleString()}
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <Button
                    className="flex-1"
                    size="sm"
                    variant={connected ? "outline" : "default"}
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        provider: app.provider,
                        category: app.category,
                        display_name: app.name,
                        status: connected ? "disconnected" : "connected",
                      })
                    }
                  >
                    {connected ? (
                      <Unplug className="size-3.5 mr-1.5" />
                    ) : (
                      <Plug className="size-3.5 mr-1.5" />
                    )}
                    {connected ? "Disconnect" : "Connect"}
                  </Button>
                  {connected && (
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() =>
                        mutation.mutate({
                          provider: app.provider,
                          category: app.category,
                          display_name: app.name,
                          status: "connected",
                        })
                      }
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
