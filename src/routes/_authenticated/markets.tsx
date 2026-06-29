import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createMarketSignal, listMarketSignals } from "@/lib/operations.functions";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Plus, Radar } from "lucide-react";
import { toast } from "sonner";

const signalsQ = queryOptions({ queryKey: ["market-signals"], queryFn: () => listMarketSignals() });

export const Route = createFileRoute("/_authenticated/markets")({
  head: () => ({ meta: [{ title: "Markets | Agir" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(signalsQ),
  component: MarketsPage,
});

function MarketsPage() {
  const { data: signals } = useSuspenseQuery(signalsQ);
  const [open, setOpen] = useState(false);
  const [market, setMarket] = useState("all");
  useRealtimeRefresh();
  const markets = useMemo<string[]>(
    () => Array.from(new Set<string>((signals as any[]).map((signal) => String(signal.market)))),
    [signals],
  );
  const visible =
    market === "all" ? signals : signals.filter((signal: any) => signal.market === market);

  return (
    <>
      <PageHeader
        eyebrow="External context"
        title="Market tracking"
        subtitle="Track the indicators that can change valuation, financing and execution decisions."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4 mr-1.5" />
                Add signal
              </Button>
            </DialogTrigger>
            <SignalDialog onClose={() => setOpen(false)} />
          </Dialog>
        }
      />
      <PageBody>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-success">
            <Radar className="size-3" />
            Live market watchlist
          </div>
          <Select value={market} onValueChange={setMarket}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All markets</SelectItem>
              {markets.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {visible.length ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {visible.map((signal: any) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        ) : (
          <Card className="p-16 text-center elevated">
            <Radar className="size-9 mx-auto text-muted-foreground" />
            <div className="text-sm font-medium mt-3">No market signals yet</div>
            <p className="text-xs text-muted-foreground mt-1">
              Add cap rates, rents, vacancy, construction costs or financing benchmarks.
            </p>
          </Card>
        )}
      </PageBody>
    </>
  );
}

function SignalCard({ signal }: { signal: any }) {
  const Icon =
    signal.trend === "up" ? ArrowUpRight : signal.trend === "down" ? ArrowDownRight : ArrowRight;
  return (
    <Card className="p-5 elevated">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {signal.market}
          </div>
          <div className="font-semibold mt-1">{signal.metric}</div>
        </div>
        <Icon
          className={`size-5 ${signal.trend === "up" ? "text-success" : signal.trend === "down" ? "text-destructive" : "text-muted-foreground"}`}
        />
      </div>
      <div className="num text-3xl mt-5">
        {Number(signal.value_numeric).toLocaleString()}
        <span className="text-sm text-muted-foreground ml-1">{signal.unit}</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground mt-4">
        <span>{signal.period || signal.observed_at}</span>
        <span>{signal.source || "Internal"}</span>
      </div>
    </Card>
  );
}

function SignalDialog({ onClose }: { onClose: () => void }) {
  const fn = useServerFn(createMarketSignal);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    market: "",
    metric: "",
    value_numeric: 0,
    unit: "%",
    period: "",
    trend: "flat",
    source: "",
    observed_at: new Date().toISOString().slice(0, 10),
  });
  const mutation = useMutation({
    mutationFn: () =>
      fn({ data: { ...form, period: form.period || null, source: form.source || null } as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["market-signals"] });
      toast.success("Market signal added");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add market signal</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Market</Label>
          <Input
            value={form.market}
            onChange={(event) => setForm({ ...form, market: event.target.value })}
            placeholder="Vancouver Industrial"
          />
        </div>
        <div>
          <Label>Metric</Label>
          <Input
            value={form.metric}
            onChange={(event) => setForm({ ...form, metric: event.target.value })}
            placeholder="Market cap rate"
          />
        </div>
        <div>
          <Label>Value</Label>
          <Input
            type="number"
            step="0.01"
            value={form.value_numeric}
            onChange={(event) => setForm({ ...form, value_numeric: Number(event.target.value) })}
          />
        </div>
        <div>
          <Label>Unit</Label>
          <Input
            value={form.unit}
            onChange={(event) => setForm({ ...form, unit: event.target.value })}
          />
        </div>
        <div>
          <Label>Trend</Label>
          <Select value={form.trend} onValueChange={(value) => setForm({ ...form, trend: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="up">Up</SelectItem>
              <SelectItem value="flat">Flat</SelectItem>
              <SelectItem value="down">Down</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Observed</Label>
          <Input
            type="date"
            value={form.observed_at}
            onChange={(event) => setForm({ ...form, observed_at: event.target.value })}
          />
        </div>
        <div>
          <Label>Period</Label>
          <Input
            value={form.period}
            onChange={(event) => setForm({ ...form, period: event.target.value })}
            placeholder="Q2 2026"
          />
        </div>
        <div>
          <Label>Source</Label>
          <Input
            value={form.source}
            onChange={(event) => setForm({ ...form, source: event.target.value })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!form.market || !form.metric || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Add signal
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
