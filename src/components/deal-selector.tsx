import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DealSelector({
  projects,
  value,
  onChange,
}: {
  projects: any[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <Card className="p-3 flex flex-wrap items-center gap-3">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold pl-1">
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
