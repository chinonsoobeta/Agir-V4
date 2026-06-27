import { createFileRoute } from "@tanstack/react-router";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listIntegrations, setIntegration } from "@/lib/operations.functions";
import {
  importDeals,
  listIntegrationRuns,
  listWebhookEndpoints,
  runIntegrationSync,
  saveWebhookEndpoint,
} from "@/lib/operating-depth.functions";
import { useWorkspace } from "@/lib/workspace-context";
import { CONNECTOR_REGISTRY } from "@/lib/integrations/connector";
import { exportDealsCsv, importDealsCsv } from "@/lib/operating-layer.functions";
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
  Upload,
  History,
  AlertCircle,
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
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.personal ? null : activeWorkspace?.id;
  const runsQ = useQuery({
    queryKey: ["integration-runs", workspaceId],
    queryFn: () => listIntegrationRuns({ data: { workspace_id: workspaceId } }),
  });
  const webhooksQ = useQuery({
    queryKey: ["webhooks", workspaceId],
    queryFn: () => listWebhookEndpoints({ data: { workspace_id: workspaceId } }),
  });
  const fn = useServerFn(setIntegration);
  const syncFn = useServerFn(runIntegrationSync);
  const importFn = useServerFn(importDeals);
  const webhookFn = useServerFn(saveWebhookEndpoint);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [webhook, setWebhook] = useState({
    name: "",
    endpoint_url: "",
    event_types: "deal.updated",
  });
  useRealtimeRefresh();
  const mutation = useMutation({
    mutationFn: (data: any) => fn({ data: { ...data, workspace_id: workspaceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Integration updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const sync = useMutation({
    mutationFn: (connectionId: string) =>
      syncFn({ data: { connection_id: connectionId, workspace_id: workspaceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      qc.invalidateQueries({ queryKey: ["integration-runs", workspaceId] });
      toast.success("Connection verified and sync completed");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const csvImport = useMutation({
    mutationFn: (rows: any[]) => importFn({ data: { workspace_id: workspaceId, rows } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast.success(`Imported ${result.imported} deals`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const createWebhook = useMutation({
    mutationFn: () =>
      webhookFn({
        data: {
          workspace_id: workspaceId,
          name: webhook.name,
          endpoint_url: webhook.endpoint_url,
          event_types: webhook.event_types
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webhooks", workspaceId] });
      setWebhookOpen(false);
      setWebhook({ name: "", endpoint_url: "", event_types: "deal.updated" });
      toast.success("Webhook endpoint created");
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

        {/* 3C: honest connector status. Only "live" connectors perform a real
            round-trip; planned ones are never shown as connected. */}
        <Card className="p-5 elevated">
          <div className="flex items-center gap-2">
            <Plug className="size-4 text-muted-foreground" />
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Connector status
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Only connectors marked Live perform a real import / export round-trip today. Planned
            connectors are disclosed as roadmap, never shown as connected.
          </p>
          <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {CONNECTOR_REGISTRY.map((c) => (
              <div
                key={c.provider}
                className="rounded border border-border p-2 flex items-center justify-between gap-2"
              >
                <span className="text-sm">{c.label}</span>
                <Badge
                  variant="outline"
                  className={`text-[9px] uppercase ${c.status === "live" ? "text-success border-success/40" : "text-muted-foreground"}`}
                >
                  {c.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <CsvConnectorPanel connections={connections} workspaceId={workspaceId} />

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                csvImport.mutate(parseDealCsv(await file.text()));
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not parse CSV");
              } finally {
                event.target.value = "";
              }
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4 mr-1.5" />
            Import deal CSV
          </Button>
          <Button variant="outline" onClick={() => setWebhookOpen(true)}>
            <Webhook className="size-4 mr-1.5" />
            Add webhook
          </Button>
        </div>
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
                      disabled={sync.isPending || !connection?.id?.match(/^[0-9a-f-]{36}$/i)}
                      title="Run connectivity check"
                      onClick={() => sync.mutate(connection.id)}
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-5 elevated">
            <div className="flex items-center gap-2">
              <History className="size-4 text-primary" />
              <div className="font-semibold">Sync history</div>
            </div>
            <div className="mt-4 space-y-2">
              {(runsQ.data ?? []).length ? (
                (runsQ.data ?? []).slice(0, 8).map((run: any) => (
                  <div key={run.id} className="flex items-center gap-3 rounded-md border p-3">
                    <div
                      className={`size-2 rounded-full ${run.status === "succeeded" ? "bg-success" : run.status === "failed" ? "bg-destructive" : "bg-warning"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {run.integration_connections?.display_name ?? "Integration"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {run.records_read} read · {run.records_written} written ·{" "}
                        {new Date(run.started_at).toLocaleString()}
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {run.status}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No sync runs yet. Connect a system and run a check.
                </p>
              )}
            </div>
          </Card>
          <Card className="p-5 elevated">
            <div className="flex items-center gap-2">
              <Webhook className="size-4 text-primary" />
              <div className="font-semibold">Outbound webhooks</div>
            </div>
            <div className="mt-4 space-y-2">
              {(webhooksQ.data ?? []).length ? (
                (webhooksQ.data ?? []).map((endpoint: any) => (
                  <div key={endpoint.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{endpoint.name}</div>
                      <Badge variant="outline">{endpoint.active ? "Active" : "Paused"}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-1">
                      {endpoint.endpoint_url}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-2">
                      Events: {endpoint.event_types.join(", ")}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No webhook endpoints configured.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
      <Dialog open={webhookOpen} onOpenChange={setWebhookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                value={webhook.name}
                onChange={(event) => setWebhook({ ...webhook, name: event.target.value })}
                placeholder="Data warehouse updates"
              />
            </div>
            <div>
              <Label>HTTPS endpoint</Label>
              <Input
                value={webhook.endpoint_url}
                onChange={(event) => setWebhook({ ...webhook, endpoint_url: event.target.value })}
                placeholder="https://example.com/hooks/agir"
              />
            </div>
            <div>
              <Label>Events, comma separated</Label>
              <Input
                value={webhook.event_types}
                onChange={(event) => setWebhook({ ...webhook, event_types: event.target.value })}
                placeholder="deal.updated, decision.recorded"
              />
            </div>
            <div className="flex gap-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              <AlertCircle className="size-4 shrink-0" />
              Delivery secrets are never displayed after creation. Rotate endpoints if a secret is
              exposed.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWebhookOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!webhook.name || !webhook.endpoint_url || createWebhook.isPending}
              onClick={() => createWebhook.mutate()}
            >
              Create endpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function parseDealCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV must contain a header and at least one deal.");
  const split = (line: string) =>
    line
      .match(/("([^"]|"")*"|[^,]*)(,|$)/g)
      ?.map((cell) => cell.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ??
    [];
  const headers = split(lines[0]).map((value) => value.toLowerCase().replace(/\s+/g, "_"));
  const required = headers.indexOf("name");
  if (required < 0) throw new Error("CSV requires a name column.");
  const allowedTypes = new Set([
    "industrial",
    "mixed_use",
    "multifamily",
    "office",
    "retail",
    "hospitality",
    "self_storage",
    "data_center",
    "life_science",
    "commercial",
    "land",
    "other",
  ]);
  return lines.slice(1).map((line, index) => {
    const cells = split(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
    if (!row.name) throw new Error(`Row ${index + 2} is missing a deal name.`);
    return {
      name: row.name,
      location: row.location || null,
      type: allowedTypes.has(row.type) ? row.type : "other",
      source: row.source || "CSV import",
      probability: Number(row.probability || 25),
      acquisition_cost: Number(row.acquisition_cost || 0),
      target_close_date: row.target_close_date || null,
    };
  });
}

// 3C: the live CSV connector, end to end. Explicit field mapping (external
// column -> internal field) drives both export (download) and import (paste).
// Import is idempotent via external_record_links and records a sync run.
function CsvConnectorPanel({
  connections,
  workspaceId,
}: {
  connections: any[];
  workspaceId: string | null | undefined;
}) {
  const qc = useQueryClient();
  const ensureFn = useServerFn(setIntegration);
  const exportFn = useServerFn(exportDealsCsv);
  const importFn = useServerFn(importDealsCsv);
  const csvConn = connections.find((c: any) => c.provider === "csv");
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    failed: number;
    parseErrors: string[];
  } | null>(null);

  // The explicit mapping used for both directions.
  const MAPPING: Record<string, string> = {
    "Deal ID": "external_id",
    Name: "name",
    Market: "location",
    Source: "source",
    "Win %": "probability",
    "Target Close": "target_close_date",
  };

  const enable = useMutation({
    mutationFn: () =>
      ensureFn({
        data: {
          provider: "csv",
          category: "spreadsheet",
          display_name: "CSV Import / Export",
          status: "connected",
          workspace_id: workspaceId ?? null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("CSV connector enabled");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const doExport = useMutation({
    mutationFn: () => exportFn({ data: { connection_id: csvConn.id, mapping: MAPPING } }),
    onSuccess: (r: any) => {
      const blob = new Blob([r.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "agir_deals_export.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${r.recordCount} deal(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const doImport = useMutation({
    mutationFn: () =>
      importFn({ data: { connection_id: csvConn.id, csv: csvText, mapping: MAPPING } }),
    onSuccess: (r: any) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Import complete: ${r.created} new, ${r.updated} updated, ${r.failed} failed`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 elevated">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="size-4 text-primary" />
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          CSV deal sync (live connector)
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        Explicit field mapping:{" "}
        {Object.entries(MAPPING)
          .map(([col, field]) => `${col} -> ${field}`)
          .join(", ")}
        . Imports are idempotent (re-importing a Deal ID updates the same deal).
      </p>
      {!csvConn ? (
        <Button
          size="sm"
          className="mt-3"
          disabled={enable.isPending}
          onClick={() => enable.mutate()}
        >
          <Plug className="size-4 mr-1.5" />
          Enable CSV connector
        </Button>
      ) : (
        <div className="mt-3 space-y-3">
          <Button
            size="sm"
            variant="outline"
            disabled={doExport.isPending}
            onClick={() => doExport.mutate()}
          >
            <RefreshCw className="size-4 mr-1.5" />
            Export deals to CSV
          </Button>
          <textarea
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-mono h-28"
            placeholder={
              "Paste CSV with a header row, e.g.\nDeal ID,Name,Market,Source,Win %,Target Close\nCRM-1,Harbour Centre,Vancouver,broker,60,2026-09-01"
            }
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!csvText.trim() || doImport.isPending}
            onClick={() => doImport.mutate()}
          >
            <Upload className="size-4 mr-1.5" />
            Import deals from CSV
          </Button>
          {result && (
            <div className="text-xs text-muted-foreground">
              Imported {result.created} new, {result.updated} updated, {result.failed} failed.
              {result.parseErrors.length > 0 && (
                <span className="text-warning"> {result.parseErrors.slice(0, 3).join("; ")}</span>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
