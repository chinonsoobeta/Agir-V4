import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, FileText, Rocket, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { seedHarbourCentre } from "@/lib/demo.functions";
import { PILOT_DEAL_PACKAGES, type PilotDealPackage } from "@/lib/pilot-demo-packages";

type DemoPackagePickerProps = {
  trigger: ReactNode;
};

const AVAILABILITY_LABEL: Record<PilotDealPackage["availability"], string> = {
  seedable: "Seedable",
  fixture_only: "Fixture package",
  corpus_harness: "Corpus harness",
};

export function DemoPackagePicker({ trigger }: DemoPackagePickerProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const seedFn = useServerFn(seedHarbourCentre);
  const seed = useMutation({
    mutationFn: () => seedFn(),
    onSuccess: ({ project_id }: { project_id?: string }) => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success("Harbour Centre seeded", {
        action: project_id
          ? {
              label: "Open demo",
              onClick: () => navigate({ to: "/projects/$id", params: { id: project_id } }),
            }
          : undefined,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="display text-xl">Demo packages</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          {PILOT_DEAL_PACKAGES.map((pkg) => (
            <div key={pkg.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold">{pkg.name}</div>
                    <Badge variant={pkg.availability === "seedable" ? "default" : "outline"}>
                      {AVAILABILITY_LABEL[pkg.availability]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
                    {pkg.assetType}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{pkg.intendedOutcome}</p>
                </div>
                {pkg.availability === "seedable" ? (
                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={() => seed.mutate()}
                    disabled={seed.isPending}
                  >
                    <Rocket className="mr-1.5 size-4" />
                    {seed.isPending ? "Seeding..." : "Seed package"}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="shrink-0" disabled>
                    <FileText className="mr-1.5 size-4" />
                    Fixture only
                  </Button>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <PackageList title="Workflow" items={pkg.expectedWorkflow} icon="arrow" />
                <PackageList title="Watchpoints" items={pkg.knownWatchpoints} icon="spark" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pkg.documents.map((doc) => (
                  <span
                    key={doc}
                    className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground"
                  >
                    {doc}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PackageList({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: "arrow" | "spark";
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs">
            {icon === "arrow" ? (
              <ArrowRight className="mt-0.5 size-3 shrink-0 text-primary" />
            ) : (
              <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />
            )}
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
