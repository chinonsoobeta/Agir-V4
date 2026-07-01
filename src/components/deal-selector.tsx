import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Tables } from "@/integrations/supabase/types";

export function DealSelector({
  projects,
  value,
  onChange,
}: {
  projects: Pick<Tables<"projects">, "id" | "name">[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <Card className="p-3 flex flex-wrap items-center gap-3">
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold pl-1">
        Deal
      </span>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-auto sm:min-w-[260px]">
          <SelectValue placeholder="Select a deal" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Card>
  );
}
