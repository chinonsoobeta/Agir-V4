import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProject } from "@/lib/projects.functions";
import { listDocuments, createDocument } from "@/lib/documents.functions";
import { listAssumptions, listFinancialOutputs, listDecisions } from "@/lib/assumptions.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, FileText, MapPin, Upload } from "lucide-react";
import { useState, useRef } from "react";
import { AssumptionReviewCenter } from "@/components/assumption-review";
import { AuditPanel } from "@/components/underwriting-panel";
import { CommitteePanel } from "@/components/committee-panel";
import { AnalysisPanel } from "@/components/analysis-panel";
import { DealOverview } from "@/components/deal-overview";
import { DealTimeline } from "@/components/deal-timeline";
import { buildDecision, pipelineStageFor, RECOMMENDATION_TONE } from "@/lib/decision";
import { assetTypeLabel } from "@/lib/asset-types";
import { ScoreDial, RecommendationPill, RiskPill } from "@/components/decision-ui";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const projectQ = (id: string) =>
  queryOptions({ queryKey: ["project", id], queryFn: () => getProject({ data: { id } }) });
const docsQ = (id: string) =>
  queryOptions({
    queryKey: ["docs", id],
    queryFn: () => listDocuments({ data: { project_id: id } }),
  });
const assumptionsQ = (id: string) =>
  queryOptions({
    queryKey: ["assumptions", id],
    queryFn: () => listAssumptions({ data: { project_id: id } }),
  });
const outputsQ = (id: string) =>
  queryOptions({
    queryKey: ["outputs", id],
    queryFn: () => listFinancialOutputs({ data: { project_id: id } }),
  });
const decisionsQ = (id: string) =>
  queryOptions({
    queryKey: ["decisions", id],
    queryFn: () => listDecisions({ data: { project_id: id } }),
  });

const TABS = [
  { value: "decision", label: "Decision" },
  { value: "assumptions", label: "Assumptions" },
  { value: "analysis", label: "Analysis" },
  { value: "committee", label: "Investment Committee" },
  { value: "documents", label: "Documents" },
  { value: "timeline", label: "Timeline" },
  { value: "audit", label: "Audit" },
] as const;

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Deal — Agir" }] }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(projectQ(params.id)),
  component: DealDetail,
});

function DealDetail() {
  const { id } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("decision");
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["decision"]));
  const { data: project } = useSuspenseQuery(projectQ(id));
  const { data: documents = [] } = useSuspenseQuery(docsQ(id));
  const { data: assumptions = [] } = useSuspenseQuery(assumptionsQ(id));
  const { data: outputs = [] } = useSuspenseQuery(outputsQ(id));
  const { data: decisions = [] } = useSuspenseQuery(decisionsQ(id));

  const decision = buildDecision(outputs as any, assumptions as any);
  const stage = pipelineStageFor({
    status: project.status,
    docCount: documents.length,
    hasUnderwriting: decision.hasUnderwriting,
    decisions: decisions as any,
  });
  const recTone = RECOMMENDATION_TONE[decision.recommendation];

  return (
    <>
      {/* Deal banner */}
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="px-8 pt-5 pb-6">
          <div className="flex items-center justify-between">
            <Link to="/deals">
              <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2">
                <ArrowLeft className="size-4 mr-1" />
                All deals
              </Button>
            </Link>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
              {stage}
            </div>
          </div>
          <div className="mt-3 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="min-w-0">
              <h1 className="display text-3xl font-semibold tracking-tight">{project.name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                <MapPin className="size-3.5" />
                {project.location || "—"}
                <span className="text-border">·</span>
                <span>{assetTypeLabel(project.type)}</span>
              </div>
              {decision.hasUnderwriting && (
                <div className="flex items-center gap-2.5 mt-4">
                  <RecommendationPill rec={decision.recommendation} />
                  <RiskPill rating={decision.riskRating} />
                </div>
              )}
            </div>
            {decision.hasUnderwriting && (
              <div className="flex gap-8 shrink-0">
                <ScoreDial
                  value={decision.investmentScore}
                  label="Investment Score"
                  tone={recTone}
                  size={116}
                />
                <ScoreDial
                  value={decision.confidenceScore}
                  label="Confidence"
                  tone="return"
                  size={116}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="p-8">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as any);
            setVisited((p) => new Set(p).add(v));
          }}
        >
          <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1 bg-transparent border-b border-border rounded-none p-0">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground rounded-none px-4 py-2.5 text-muted-foreground"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent
            value="decision"
            forceMount
            className={tab === "decision" ? "mt-6" : "hidden"}
          >
            <DealOverview decision={decision} />
          </TabsContent>
          <TabsContent value="assumptions" className="mt-6">
            {visited.has("assumptions") && <AssumptionReviewCenter projectId={id} />}
          </TabsContent>
          <TabsContent value="analysis" className="mt-6">
            {visited.has("analysis") && <AnalysisPanel projectId={id} />}
          </TabsContent>
          <TabsContent value="committee" className="mt-6">
            {visited.has("committee") && <CommitteePanel projectId={id} />}
          </TabsContent>
          <TabsContent value="documents" className="mt-6">
            {visited.has("documents") && <DocumentsTab projectId={id} />}
          </TabsContent>
          <TabsContent value="timeline" className="mt-6">
            {visited.has("timeline") && <DealTimeline projectId={id} />}
          </TabsContent>
          <TabsContent value="audit" className="mt-6">
            {visited.has("audit") && <AuditPanel projectId={id} />}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

const CATEGORIES = [
  "Appraisal",
  "Budget",
  "Site Plan",
  "Financial Model",
  "Market Study",
  "Loan Package",
  "Legal",
  "Other",
];

function DocumentsTab({ projectId }: { projectId: string }) {
  const { data: docs = [] } = useSuspenseQuery(docsQ(projectId));
  const qc = useQueryClient();
  const createFn = useServerFn(createDocument);
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>("Other");
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not authenticated");
      const path = `${u.user.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("documents").upload(path, file);
      if (error) throw error;
      await createFn({
        data: {
          project_id: projectId,
          name: file.name,
          file_type: file.type,
          category,
          storage_path: path,
          size_bytes: file.size,
        },
      });
      qc.invalidateQueries({ queryKey: ["docs", projectId] });
      toast.success("Document uploaded");
      setCategory("Other");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="grid md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Category
            </label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="md:col-span-3"
          >
            <Upload className="size-4 mr-2" />
            {uploading ? "Uploading…" : "Upload document"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 elevated">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Deal Documents
        </div>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">
            No documents linked to this deal yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between text-sm border-b border-border pb-2.5"
              >
                <span className="flex items-center gap-2.5">
                  <FileText className="size-4 text-primary" />
                  {d.name}
                </span>
                <span className="text-xs text-muted-foreground">{d.category || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
