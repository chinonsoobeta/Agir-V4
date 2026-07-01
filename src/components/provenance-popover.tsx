import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// "Explain this number": click any rendered engine figure to see its lineage --
// the human-readable formula (with the actual input values substituted in), the
// scenario it belongs to, and the approved engine inputs that fed it. The engine
// already verifies provenance internally (every output traces to approved
// inputs or a pure function thereof); this surfaces that provenance to the user.

function prettyKey(key: string): string {
  return key
    .replace(/^occupancy:/, "occupancy: ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ExplainableRow =
  | {
      metric_label?: string | null;
      formula_text?: string | null;
      unit?: string | null;
      scenario_key?: string | null;
      inputs?: { engine_input_keys?: string[]; scenario?: string } | null;
    }
  | null
  | undefined;

export function ExplainableNumber({
  children,
  row,
  label,
  className,
}: {
  children: React.ReactNode;
  row: ExplainableRow;
  label?: string;
  className?: string;
}) {
  // Without a formula there is nothing to explain -- render plainly.
  if (!row || !row.formula_text) return <span className={className}>{children}</span>;
  const inputKeys = row.inputs?.engine_input_keys ?? [];
  const scenario = row.scenario_key ?? row.inputs?.scenario ?? "base";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            "cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:decoration-primary focus:outline-none " +
            (className ?? "")
          }
          aria-label={`Explain ${label ?? row.metric_label ?? "this number"}`}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[92vw] text-sm">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          <Info className="size-3.5" />
          {label ?? row.metric_label ?? "Provenance"}
        </div>
        <div className="mt-2 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              How it is computed
            </div>
            <div className="font-mono text-xs bg-muted/50 rounded p-2 leading-snug break-words">
              {row.formula_text}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">scenario: {scenario}</span>
            {row.unit ? (
              <span className="rounded bg-muted px-1.5 py-0.5">unit: {row.unit}</span>
            ) : null}
          </div>
          {inputKeys.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Approved inputs in this calculation ({inputKeys.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {inputKeys.map((k) => (
                  <span
                    key={k}
                    className="rounded border border-border bg-card px-1.5 py-0.5 text-[11px]"
                  >
                    {prettyKey(k)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
            Every figure is derived only from approved/accepted inputs by the deterministic engine
            -- no value is invented.
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
