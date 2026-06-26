// WS2 / 2D. RLS-scoped persistence for the learning store. All reads/writes go
// through the user-scoped supabase client (context.supabase), so a user only ever
// sees/writes aliases and templates they own or share via a workspace. Every call
// is best-effort and migration-safe: if the tables are not yet applied to the
// deployed schema, reads return empty and writes no-op, so extraction/review never
// break. The learning layer only ever records STRUCTURE (label -> key); values are
// always read from document tokens by the deterministic pipeline.

import { isMissingRelation } from "./db-compat";
import type { LearnedAlias, TemplateEntry } from "./extraction-learning";

export type LearningScope = { workspaceId: string | null };

// Apply the workspace/personal scope to a query so reads/writes stay tenant-clean.
// When the project belongs to a workspace, learning is shared with that workspace;
// otherwise it is personal to the owner.
function scoped<Q extends { eq: (c: string, v: unknown) => Q; is: (c: string, v: null) => Q }>(
  q: Q,
  ctx: { userId: string },
  scope: LearningScope,
): Q {
  return scope.workspaceId ? q.eq("workspace_id", scope.workspaceId) : q.is("workspace_id", null).eq("owner_id", ctx.userId);
}

export async function loadProjectScope(ctx: any, projectId: string): Promise<LearningScope> {
  try {
    const { data, error } = await ctx.supabase.from("projects").select("workspace_id").eq("id", projectId).single();
    if (error) return { workspaceId: null };
    return { workspaceId: (data?.workspace_id as string | null) ?? null };
  } catch {
    return { workspaceId: null };
  }
}

export async function loadLearnedAliases(ctx: any, scope: LearningScope): Promise<LearnedAlias[]> {
  const { data, error } = await scoped(
    ctx.supabase.from("extraction_aliases").select("field_key,alias_text"),
    ctx,
    scope,
  );
  if (error) {
    if (!isMissingRelation(error)) console.warn("[extraction-learning] alias load failed:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({ field_key: r.field_key, alias_text: r.alias_text }));
}

export async function loadTemplates(ctx: any, scope: LearningScope, fingerprints: string[]): Promise<TemplateEntry[]> {
  if (!fingerprints.length) return [];
  const { data, error } = await scoped(
    ctx.supabase.from("counterparty_templates").select("fingerprint,label,field_key").in("fingerprint", fingerprints),
    ctx,
    scope,
  );
  if (error) {
    if (!isMissingRelation(error)) console.warn("[extraction-learning] template load failed:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({ fingerprint: r.fingerprint, label: r.label, field_key: r.field_key }));
}

// Insert only genuinely new aliases (filtered against `existing` so we never fight
// the unique index). Best-effort: a missing table or a race is swallowed.
export async function recordLearnedAliases(
  ctx: any,
  scope: LearningScope,
  aliases: LearnedAlias[],
  existing: LearnedAlias[],
): Promise<number> {
  const have = new Set(existing.map((a) => `${a.field_key} ${a.alias_text}`));
  const seen = new Set<string>();
  const rows = aliases
    .filter((a) => {
      const k = `${a.field_key} ${a.alias_text}`;
      if (have.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((a) => ({
      workspace_id: scope.workspaceId,
      owner_id: ctx.userId,
      created_by: ctx.userId,
      field_key: a.field_key,
      alias_text: a.alias_text,
    }));
  if (!rows.length) return 0;
  const { error } = await ctx.supabase.from("extraction_aliases").insert(rows);
  if (error && !isMissingRelation(error)) {
    // A unique-violation under a race is fine; anything else is logged, never thrown.
    if (error.code !== "23505") console.warn("[extraction-learning] alias write failed:", error.message);
    return 0;
  }
  return rows.length;
}

export async function recordTemplates(
  ctx: any,
  scope: LearningScope,
  entries: TemplateEntry[],
  existing: TemplateEntry[],
): Promise<number> {
  const have = new Set(existing.map((t) => `${t.fingerprint} ${t.label} ${t.field_key}`));
  const seen = new Set<string>();
  const rows = entries
    .filter((t) => {
      const k = `${t.fingerprint} ${t.label} ${t.field_key}`;
      if (have.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((t) => ({
      workspace_id: scope.workspaceId,
      owner_id: ctx.userId,
      created_by: ctx.userId,
      fingerprint: t.fingerprint,
      label: t.label,
      field_key: t.field_key,
    }));
  if (!rows.length) return 0;
  const { error } = await ctx.supabase.from("counterparty_templates").insert(rows);
  if (error && !isMissingRelation(error)) {
    if (error.code !== "23505") console.warn("[extraction-learning] template write failed:", error.message);
    return 0;
  }
  return rows.length;
}
