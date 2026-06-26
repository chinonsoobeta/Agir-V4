// Execution critical path (Workstream 3A). Pure, deterministic graph math over
// milestone dependencies: no I/O, no clock of its own (today is passed in so the
// computation is reproducible and testable).
//
// Given milestones with predecessor links (depends_on) and planned due dates,
// it computes the longest dependency chain by date (the critical path), the
// projected close date implied by that chain, and exactly which open or overdue
// items threaten the target close. Dependency cycles are detected and reported
// rather than causing infinite recursion.

export type MilestoneStatus = "not_started" | "in_progress" | "blocked" | "complete";

export type ExecMilestone = {
  id: string;
  title: string;
  dueDate: string | null; // ISO date (YYYY-MM-DD) or null
  status: MilestoneStatus;
  dependsOn: string[]; // predecessor milestone ids
  priority?: string;
};

export type BlockingReason = "overdue" | "on_critical_path" | "blocked_by_incomplete";

export type BlockingItem = {
  id: string;
  title: string;
  dueDate: string | null;
  reasons: BlockingReason[];
  // Days of slack to the target close (negative = projected past close). Null
  // when there is no target close date or no dated chain.
  slackDays: number | null;
};

export type CriticalPathResult = {
  // Topological order of milestone ids (cycle edges excluded).
  order: string[];
  // Ids on the longest-by-date dependency chain (the critical path).
  criticalPath: string[];
  // Latest chain finish date across all milestones (the projected close).
  projectedCloseDate: string | null;
  // Open / overdue items that actually threaten the close, worst-first.
  blocking: BlockingItem[];
  // Detected dependency cycles (each a list of ids); empty when acyclic.
  cycles: string[][];
  hasCycle: boolean;
};

const DAY_MS = 86_400_000;
const epoch = (d: string | null): number | null => {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
};
const isoFromEpoch = (ms: number | null): string | null => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));
const isComplete = (m: ExecMilestone) => m.status === "complete";

export function computeCriticalPath(
  milestones: ExecMilestone[],
  targetCloseDate: string | null,
  today: string,
): CriticalPathResult {
  const byId = new Map(milestones.map((m) => [m.id, m]));
  // Only keep edges that point at a real milestone (drop dangling links).
  const preds = new Map<string, string[]>();
  for (const m of milestones) preds.set(m.id, m.dependsOn.filter((p) => byId.has(p) && p !== m.id));

  // ---- Cycle detection (DFS coloring). Cycle edges are excluded from the
  // longest-path memo so the computation always terminates. ----
  const color = new Map<string, 0 | 1 | 2>(); // 0=unvisited 1=in-stack 2=done
  const cycles: string[][] = [];
  const stack: string[] = [];
  const inCycleEdge = new Set<string>(); // "child->pred" edges to skip
  const dfsCycle = (id: string) => {
    color.set(id, 1);
    stack.push(id);
    for (const p of preds.get(id) ?? []) {
      const c = color.get(p) ?? 0;
      if (c === 1) {
        // Back-edge: capture the cycle slice and break it.
        const from = stack.indexOf(p);
        if (from >= 0) cycles.push(stack.slice(from));
        inCycleEdge.add(`${id}->${p}`);
      } else if (c === 0) {
        dfsCycle(p);
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const m of milestones) if ((color.get(m.id) ?? 0) === 0) dfsCycle(m.id);
  const livePreds = (id: string) => (preds.get(id) ?? []).filter((p) => !inCycleEdge.has(`${id}->${p}`));

  // ---- Topological order (Kahn over the acyclic edge set). ----
  const indegree = new Map<string, number>();
  for (const m of milestones) indegree.set(m.id, 0);
  for (const m of milestones) for (const _p of livePreds(m.id)) indegree.set(m.id, (indegree.get(m.id) ?? 0) + 1);
  const ready = milestones.filter((m) => (indegree.get(m.id) ?? 0) === 0).map((m) => m.id);
  const order: string[] = [];
  const dependents = new Map<string, string[]>();
  for (const m of milestones) for (const p of livePreds(m.id)) dependents.set(p, [...(dependents.get(p) ?? []), m.id]);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const d of dependents.get(id) ?? []) {
      indegree.set(d, (indegree.get(d) ?? 1) - 1);
      if ((indegree.get(d) ?? 0) === 0) ready.push(d);
    }
  }

  // ---- Longest finish date per milestone: max(own due, max predecessor
  // finish). A milestone's chain cannot realistically finish before any of its
  // predecessors. Memoized over the acyclic edge set. ----
  const finishMemo = new Map<string, number | null>();
  const bestPredMemo = new Map<string, string | null>();
  const finishOf = (id: string): number | null => {
    if (finishMemo.has(id)) return finishMemo.get(id)!;
    const ownDue = epoch(byId.get(id)?.dueDate ?? null);
    finishMemo.set(id, ownDue); // guard re-entrancy
    // The binding predecessor is the latest-finishing one (it determines the
    // longest path to this node), independent of this node's own due date.
    let maxPredFinish: number | null = null;
    let bestPred: string | null = null;
    for (const p of livePreds(id)) {
      const pf = finishOf(p);
      if (pf != null && (maxPredFinish == null || pf > maxPredFinish)) {
        maxPredFinish = pf;
        bestPred = p;
      }
    }
    let best = ownDue;
    if (maxPredFinish != null && (best == null || maxPredFinish > best)) best = maxPredFinish;
    finishMemo.set(id, best);
    bestPredMemo.set(id, bestPred);
    return best;
  };
  for (const m of milestones) finishOf(m.id);

  // Projected close = latest chain finish across all milestones.
  let projectedEpoch: number | null = null;
  let tail: string | null = null;
  for (const m of milestones) {
    const f = finishOf(m.id);
    if (f != null && (projectedEpoch == null || f > projectedEpoch)) {
      projectedEpoch = f;
      tail = m.id;
    }
  }

  // Critical path: walk predecessors from the latest-finishing milestone.
  const criticalPath: string[] = [];
  let cursor = tail;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    criticalPath.unshift(cursor);
    cursor = bestPredMemo.get(cursor) ?? null;
  }
  const onCritical = new Set(criticalPath);

  // ---- Blocking analysis: which OPEN items threaten the close. ----
  const todayMs = epoch(today);
  const targetMs = epoch(targetCloseDate);
  const blocking: BlockingItem[] = [];
  for (const m of milestones) {
    if (isComplete(m)) continue;
    const reasons: BlockingReason[] = [];
    const dueMs = epoch(m.dueDate);
    if (dueMs != null && todayMs != null && dueMs < todayMs) reasons.push("overdue");
    if (onCritical.has(m.id)) reasons.push("on_critical_path");
    if (livePreds(m.id).some((p) => !isComplete(byId.get(p)!))) reasons.push("blocked_by_incomplete");
    if (!reasons.length) continue;
    const chainFinish = finishOf(m.id);
    const slackDays =
      targetMs != null && chainFinish != null ? Math.round((targetMs - chainFinish) / DAY_MS) : null;
    blocking.push({ id: m.id, title: m.title, dueDate: m.dueDate, reasons, slackDays });
  }
  // Worst-first: least slack (most negative) first, then overdue, then by title.
  blocking.sort((a, b) => {
    const sa = a.slackDays ?? 0;
    const sb = b.slackDays ?? 0;
    if (sa !== sb) return sa - sb;
    const ao = a.reasons.includes("overdue") ? 0 : 1;
    const bo = b.reasons.includes("overdue") ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });

  return {
    order,
    criticalPath,
    projectedCloseDate: isoFromEpoch(projectedEpoch),
    blocking,
    cycles,
    hasCycle: cycles.length > 0,
  };
}
