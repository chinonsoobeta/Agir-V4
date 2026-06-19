import { Card } from "@/components/ui/card";

export function DealSelector({ projects, value, onChange }: { projects: any[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <Card className="p-3 flex flex-wrap items-center gap-3">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold pl-1">Deal</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-border rounded-md px-3 py-1.5 text-sm min-w-[260px]"
      >
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </Card>
  );
}
