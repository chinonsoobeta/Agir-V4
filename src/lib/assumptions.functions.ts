// The Assumption Engine: extraction, approval, versioning, recalculation,
// readiness scoring, impact analysis, decision logging, audit trail.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ASSUMPTION_DEFS, ASSUMPTION_BY_KEY, ASSUMPTION_KEYS, REQUIRED_KEYS, bandFor } from "./assumption-taxonomy";
import { mapCandidates, groupAndResolve, rankCandidates, mapCandidateToKey, type MappedCandidate } from "./assumption-mapping";

// ---------- Read APIs ----------

export const listAssumptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("assumptions")
      .select("*, documents:source_document_id(name)")
      .eq("project_id", data.project_id)
      .order("category", { ascending: true })
      .order("field_label", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAssumptionVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { assumption_id: string }) => z.object({ assumption_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("assumption_versions").select("*").eq("assumption_id", data.assumption_id)
      .order("version_number", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listFinancialOutputs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("financial_outputs").select("*").eq("project_id", data.project_id)
      .order("scenario_key").order("metric_key");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listRisks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("risk_register").select("*").eq("project_id", data.project_id)
      .order("severity", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("decision_logs").select("*").eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("audit_logs").select("*").eq("project_id", data.project_id)
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Cross-project Review Center listing
export const listAssumptionsAcrossProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assumptions").select("*, projects:project_id(name)")
      .order("status", { ascending: true }).order("confidence_score", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Helpers ----------

async function auditLog(ctx: any, projectId: string | null, entityType: string, entityId: string | null, action: string, payload: unknown) {
  await ctx.supabase.from("audit_logs").insert({
    project_id: projectId, owner_id: ctx.userId, user_id: ctx.userId,
    entity_type: entityType, entity_id: entityId, action, payload: payload as object,
  });
}

async function userName(ctx: any) {
  const { data } = await ctx.supabase.from("profiles").select("full_name,email").eq("id", ctx.userId).maybeSingle();
  return data?.full_name || data?.email || "user";
}

async function recordVersion(ctx: any, a: any, changeReason: string, by: string) {
  await ctx.supabase.from("assumption_versions").insert({
    assumption_id: a.id, owner_id: ctx.userId, version_number: a.current_version,
    value_numeric: a.value_numeric, value_text: a.value_text, status: a.status,
    confidence_score: a.confidence_score, confidence_band: a.confidence_band,
    source_document_id: a.source_document_id, source_text: a.source_text,
    changed_by: ctx.userId, changed_by_name: by, change_reason: changeReason,
  });
}

const PRESENT_STATUSES = new Set(["extracted", "conflicting", "approved", "modified", "default_accepted", "calculated"]);
const COMPONENT_OCCUPANCY_KEYS = ["residential_occupancy", "retail_occupancy", "office_occupancy"];

function hasPresentAssumption(map: Map<string, any>, key: string) {
  const row = map.get(key);
  return Boolean(row && PRESENT_STATUSES.has(row.status) && row.status !== "rejected" && row.status !== "missing");
}

function hasCompleteComponentOccupancy(map: Map<string, any>) {
  return COMPONENT_OCCUPANCY_KEYS.every((key) => hasPresentAssumption(map, key));
}

function requiredKeysSatisfiedBy(map: Map<string, any>) {
  return REQUIRED_KEYS.filter((key) => {
    if (key === "stabilized_occupancy" && hasCompleteComponentOccupancy(map)) return true;
    return hasPresentAssumption(map, key);
  });
}

// ---------- Extraction (deterministic pipeline + debug trace) ----------
//
// Stage 1: Document parsing: regex sweep of every uploaded document yields a
//   typed candidate list (value + unit + context + label hint + source loc).
// Stage 2: Deterministic alias mapping (assumption-mapping.ts) is the
//   AUTHORITATIVE classifier: it maps each candidate to a canonical field_key
//   from its label/context + unit-kind compatibility. No LLM, no invented
//   values.
// Stage 2b: OPTIONAL AI classification runs only when an API key is configured
//   and only for candidates the deterministic stage left unresolved, for keys
//   not already resolved. It can never override a deterministic mapping nor mint
//   a value the regex pass did not lift from a document.
// Stage 3: Grouping & conflict detection: multiple distinct values for one key
//   become a conflict (value null, sources preserved, blocks underwriting).
//
// Returns the audit report plus a structured `debug` trace that pinpoints where
// a run produced: or failed to produce: values.

const ClassificationSchema = z.object({
  candidate_index: z.number().int(),
  field_key: z.string(),
  confidence_score: z.number().min(0).max(100),
  reasoning: z.string().optional(),
});

export const extractAssumptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string; mode?: "ai" | "deterministic" }) =>
    z.object({
      project_id: z.string().uuid(),
      // AI-assisted classification is the DEFAULT. It is structurally incapable
      // of inventing a value: it only assigns regex-extracted candidates (Stage
      // 1 tokens lifted verbatim from documents) to canonical keys, and it can
      // never override a deterministic alias hit. "deterministic" forces the
      // pure alias-mapping path with no model call.
      mode: z.enum(["ai", "deterministic"]).default("ai"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // AI is the default analysis path; the deterministic alias mapper is the
    // always-present backup. We fall back automatically (and record why) when no
    // key is configured or the model call fails.
    const { hasAnthropicKey } = await import("./ai-gateway.server");
    const aiAvailable = hasAnthropicKey();
    const wantsAI = data.mode === "ai";
    const useAI = wantsAI && aiAvailable;
    let aiFailureReason: string | null =
      wantsAI && !aiAvailable ? "AI unavailable (ANTHROPIC_API_KEY missing or malformed): used the deterministic engine." : null;

    const { data: docs, error: dErr } = await context.supabase
      .from("documents").select("*").eq("project_id", data.project_id);
    if (dErr) throw new Error(dErr.message);
    if (!docs?.length) throw new Error("Upload documents to this project before extracting assumptions.");

    const { extractFileText } = await import("./document-text.server");
    const { extractCandidates } = await import("./assumption-candidates.server");
    const { downloadDocumentBlob } = await import("./storage-download.server");
    const { parseRentRollWorkbook } = await import("./parsers/rent-roll.server");
    const { mapRevenueProgramRowToAssumptions } = await import("./revenue-assumption-mapper");
    const { parseBudgetWorkbook } = await import("./parsers/budget.server");
    const { aggregateBudgetRows } = await import("./budget-assumption-mapper");
    type Cand = Awaited<ReturnType<typeof extractCandidates>>[number];

    const warnings: string[] = [];
    const skippedDocs: string[] = [];
    type DocTrace = {
      document_id: string; name: string; storage_path: string;
      download_ok: boolean; byte_length: number; file_type: string | null;
      text_length: number; text_preview: string; candidate_count: number;
      candidates_preview: Array<{ kind: string; value_text: string; label_hint: string }>;
      error: string | null;
    };
    const perDocument: DocTrace[] = [];
    const allCandidates: Cand[] = [];
    const structuredRevenueMappings: MappedCandidate[] = [];
    const structuredBudgetMappings: MappedCandidate[] = [];
    const docByName = new Map(docs.map((d) => [d.name, d]));
    let documentsDownloaded = 0;

    // ===== Stage 1: parse every document, recording a debug row per doc =====
    for (const d of docs) {
      const row: DocTrace = {
        document_id: d.id, name: d.name, storage_path: d.storage_path,
        download_ok: false, byte_length: 0, file_type: d.file_type ?? null,
        text_length: 0, text_preview: "", candidate_count: 0, candidates_preview: [], error: null,
      };
      try {
        const dl = await downloadDocumentBlob(context.supabase, d.storage_path);
        if (dl.error || !dl.data) {
          row.error = dl.error?.message ?? "download failed";
          skippedDocs.push(`${d.name}: ${row.error}`);
          perDocument.push(row);
          continue;
        }
        row.download_ok = true;
        documentsDownloaded++;
        const buf = await dl.data.arrayBuffer();
        row.byte_length = buf.byteLength;
        const text = await extractFileText(d.name, d.file_type, buf);
        row.text_length = text.length;
        row.text_preview = text.slice(0, 200);
        if (!text.trim()) {
          row.error = "no extractable text";
          warnings.push(`${d.name}: downloaded ${buf.byteLength} bytes but no text could be parsed.`);
          perDocument.push(row);
          continue;
        }
        const cands = extractCandidates(d.name, text.slice(0, 40000));
        row.candidate_count = cands.length;
        row.candidates_preview = cands.slice(0, 5).map((c) => ({ kind: c.kind, value_text: c.value_text, label_hint: c.label_hint.slice(0, 48) }));
        allCandidates.push(...cands);
        if (/\.(xlsx|xls)$/i.test(d.name)) {
          const parsedRevenue = parseRentRollWorkbook(buf);
          structuredRevenueMappings.push(
            ...parsedRevenue.inserted.flatMap((revRow) => mapRevenueProgramRowToAssumptions(revRow, { name: d.name })),
          );
          const parsedBudget = parseBudgetWorkbook(buf);
          // Aggregate line items by category within this document: multiple
          // rows in one category are summed into a single category total, not
          // treated as competing conflicts.
          structuredBudgetMappings.push(...aggregateBudgetRows(parsedBudget.inserted, { name: d.name }));
        }
      } catch (error) {
        row.error = error instanceof Error ? error.message : "unreadable document";
        skippedDocs.push(`${d.name}: ${row.error}`);
      }
      perDocument.push(row);
    }
    if (!allCandidates.length) {
      warnings.push(
        skippedDocs.length
          ? `No candidates: documents could not be read (${skippedDocs.join("; ")}).`
          : "No extractable values found in uploaded documents.",
      );
    }

    // ===== Stage 2: deterministic alias mapping (authoritative) =====
    const deterministic = mapCandidates(allCandidates);
    const deterministicKeys = new Set(deterministic.map((m) => m.field_key));
    const mappedIndices = new Set<number>();
    for (let i = 0; i < allCandidates.length; i++) {
      if (mapCandidateToKey(allCandidates[i])) mappedIndices.add(i);
    }

    // ===== Stage 2b: AI classification of unresolved candidates (DEFAULT) =====
    // Primary interpreter for everything the authoritative alias mapper left
    // unresolved. It only ever assigns a regex-extracted candidate to a key.
    // the numeric value always comes from the document token, never the model.
    let classifiedCount = 0;
    const aiMapped: MappedCandidate[] = [];
    const unresolved = allCandidates.map((c, i) => ({ c, i })).filter(({ i }) => !mappedIndices.has(i));
    if (unresolved.length && useAI) {
      try {
        const rankedSet = new Set(rankCandidates(unresolved.map((u) => u.c), { cap: 160 }));
        const subset = unresolved.filter((u) => rankedSet.has(u.c));
        const taxonomyText = ASSUMPTION_DEFS.map(
          (d) => `- ${d.key} (${d.label}, unit ${d.unit}${d.required ? ", REQUIRED" : ""}) aliases: ${d.aliases.slice(0, 6).join(" / ")}`,
        ).join("\n");
        const candidateList = subset.map((u, i) =>
          `${i}. [${u.c.kind}] value=${u.c.value_text} ctx="${u.c.context.slice(0, 200)}" hint="${u.c.label_hint.slice(0, 80)}" doc="${u.c.doc_name}"`,
        ).join("\n");
        const { getAgirModel } = await import("./ai-gateway.server");
        const { generateText } = await import("ai");
        const { text } = await generateText({
          model: getAgirModel(),
          temperature: 0,
          system: `You are an institutional real estate underwriter. Classify pre-extracted numeric candidates into canonical assumption keys. Use ONLY the candidate context; never invent values. If a candidate does not match, use field_key="ignore".`,
          prompt: `Canonical taxonomy:\n${taxonomyText}\n\nCandidates:\n${candidateList}\n\nReturn a JSON array (no prose). Schema: {"candidate_index":<int>,"field_key":"<key or ignore>","confidence_score":<0-100>,"reasoning":"<short>"}.`,
        });
        const m = text.match(/\[[\s\S]*\]/);
        const parsed = m ? JSON.parse(m[0]) : [];
        const safe = z.array(ClassificationSchema).safeParse(parsed);
        if (safe.success) {
          for (const cls of safe.data) {
            if (cls.field_key === "ignore" || !ASSUMPTION_KEYS.includes(cls.field_key)) continue;
            if (deterministicKeys.has(cls.field_key)) continue; // never override deterministic
            const u = subset[cls.candidate_index];
            if (!u) continue;
            const def = ASSUMPTION_BY_KEY[cls.field_key];
            if (!def || (def.numeric && u.c.value_numeric == null)) continue;
            aiMapped.push({
              field_key: def.key,
              value_numeric: def.numeric ? u.c.value_numeric : null,
              value_text: def.numeric ? null : u.c.value_text,
              unit: def.unit,
              confidence: Math.round(cls.confidence_score),
              source_doc_name: u.c.doc_name,
              source_text: u.c.context,
              source_location: u.c.source_location,
              matched_alias: "(ai)",
              via: "alias",
            });
            classifiedCount++;
          }
        }
      } catch (error) {
        // The deterministic mapping already ran and stands on its own: an AI
        // failure degrades gracefully to it instead of failing the run.
        aiFailureReason = `AI classification failed; fell back to the deterministic engine (${error instanceof Error ? error.message : "unavailable"}).`;
        warnings.push(aiFailureReason);
      }
    }
    // The mode actually used: "ai" only when AI ran without fault and produced a
    // result; otherwise the deterministic backup carried the run.
    const analysisMode: "ai" | "deterministic" = useAI && !aiFailureReason ? "ai" : "deterministic";

    const mapped = [...deterministic, ...structuredBudgetMappings, ...structuredRevenueMappings, ...aiMapped];

    // ===== Stage 3: group & resolve (conflicts preserved) =====
    const grouped = groupAndResolve(mapped);

    const conflictKeys: string[] = [];
    const foundKeys: string[] = [];
    const proposedKeys: string[] = [];
    const auditEntries: { field_key: string; status: string; chosen?: number | string | null; alternates?: (number | string | null)[]; source_doc?: string }[] = [];

    const { data: existing } = await context.supabase
      .from("assumptions").select("*").eq("project_id", data.project_id);
    const existingByKey = new Map((existing ?? []).map((a) => [a.field_key, a]));
    const ANALYST_LOCKED = new Set(["approved", "modified", "default_accepted"]);

    let insertedAssumptions = 0;
    let updatedAssumptions = 0;

    for (const [fk, res] of grouped.entries()) {
      const def = ASSUMPTION_BY_KEY[fk];
      if (!def) continue;
      const winner = res.winner;
      const isConflict = res.status === "conflicting";

      const prev = existingByKey.get(fk);
      // Re-running extraction never silently overwrites approved/analyst rows.
      // New candidates for an approved key surface as proposed changes.
      if (prev && ANALYST_LOCKED.has(prev.status)) {
        const prevValue = prev.value_numeric != null ? Math.round(Number(prev.value_numeric) * 1000) / 1000 : prev.value_text;
        const newCandidates = res.distinct.filter((v) => v !== prevValue);
        if (newCandidates.length) {
          proposedKeys.push(fk);
          auditEntries.push({ field_key: fk, status: "proposed_change", chosen: prevValue, alternates: newCandidates, source_doc: winner.source_doc_name });
          await auditLog(context, data.project_id, "assumption", prev.id, "extraction_proposed_change", {
            field_key: fk, approved_value: prevValue, proposed_values: newCandidates, source_doc: winner.source_doc_name,
          });
        }
        continue;
      }

      if (isConflict) conflictKeys.push(fk);
      else foundKeys.push(fk);

      const srcDoc = docByName.get(winner.source_doc_name);
      const payload = {
        project_id: data.project_id, owner_id: context.userId,
        field_key: def.key, field_label: def.label, category: def.category, unit: def.unit,
        value_numeric: res.value_numeric,
        value_text: res.value_text,
        status: res.status,
        conflict_values: res.conflict_values,
        confidence_score: winner.confidence,
        confidence_band: bandFor(winner.confidence),
        source_document_id: srcDoc?.id ?? null,
        source_location: winner.source_location ?? srcDoc?.name ?? null,
        source_text: winner.source_text,
        ai_reasoning: isConflict
          ? `Conflicting values across documents: ${res.distinct.join(" vs ")}. Resolve by picking one or "use conservative": values are never averaged or blended.`
          : `Deterministically mapped via alias "${winner.matched_alias}" from ${winner.source_doc_name}.`,
      };

      if (prev) {
        const { data: upd, error: updErr } = await context.supabase.from("assumptions").update({
          ...payload, current_version: prev.current_version + 1,
        }).eq("id", prev.id).select().single();
        if (updErr) throw new Error(`Failed to update assumption ${fk}: ${updErr.message}`);
        if (upd) { await recordVersion(context, upd, `Re-extracted (${res.status})`, "Extraction Pipeline"); updatedAssumptions++; }
      } else {
        const { data: ins, error: insErr } = await context.supabase.from("assumptions").insert(payload).select().single();
        if (insErr) throw new Error(`Failed to insert assumption ${fk}: ${insErr.message}`);
        if (ins) { await recordVersion(context, ins, `Initial extraction (${res.status})`, "Extraction Pipeline"); insertedAssumptions++; }
      }

      auditEntries.push({
        field_key: fk, status: res.status,
        chosen: isConflict ? null : res.value_numeric ?? res.value_text,
        alternates: isConflict ? res.distinct : undefined,
        source_doc: winner.source_doc_name,
      });
    }

    // Derived tier: a derivable total is never "missing". If the five budget
    // components are present (and unconflicted), total_project_cost is written
    // as status='calculated' with its formula.
    const calculatedKeys: string[] = [];
    const numericFor = (key: string): number | null => {
      if (conflictKeys.includes(key)) return null;
      const fromRun = grouped.get(key);
      if (fromRun && fromRun.status !== "conflicting" && fromRun.value_numeric != null) return fromRun.value_numeric;
      const prev = existingByKey.get(key);
      if (prev && prev.status !== "missing" && prev.status !== "rejected" && prev.value_numeric != null) return Number(prev.value_numeric);
      return null;
    };
    const budgetComponentKeys = ["land_cost", "hard_costs", "soft_costs", "contingency", "financing_costs"];
    const budgetComponents = budgetComponentKeys.map((k) => ({ key: k, value: numericFor(k) }));
    const tdcPrev = existingByKey.get("total_project_cost");
    const tdcAlreadyExtracted = grouped.has("total_project_cost") ||
      (tdcPrev && !["missing", "rejected"].includes(tdcPrev.status) && tdcPrev.status !== "calculated");
    if (budgetComponents.every((c) => c.value != null) && !tdcAlreadyExtracted) {
      const total = budgetComponents.reduce((s, c) => s + (c.value ?? 0), 0);
      const fmtMoney = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
      const formula = `total_project_cost = ${budgetComponents.map((c) => `${c.key} ${fmtMoney(c.value!)}`).join(" + ")} = ${fmtMoney(total)}`;
      const def = ASSUMPTION_BY_KEY["total_project_cost"];
      const payload = {
        project_id: data.project_id, owner_id: context.userId,
        field_key: def.key, field_label: def.label, category: def.category, unit: def.unit,
        value_numeric: total, value_text: null,
        status: "calculated" as const, formula_text: formula,
        confidence_score: 100, confidence_band: "high" as const,
        ai_reasoning: "Calculated deterministically from the five extracted budget lines.",
      };
      if (tdcPrev) {
        await context.supabase.from("assumptions").update({ ...payload, current_version: tdcPrev.current_version + 1 }).eq("id", tdcPrev.id);
      } else {
        await context.supabase.from("assumptions").insert(payload);
      }
      calculatedKeys.push("total_project_cost");
      auditEntries.push({ field_key: "total_project_cost", status: "calculated", chosen: total });
    }

    // Missing placeholders for every taxonomy key not found / not already present.
    const missingKeys: string[] = [];
    for (const def of ASSUMPTION_DEFS) {
      if (grouped.has(def.key) || existingByKey.has(def.key) || calculatedKeys.includes(def.key)) continue;
      missingKeys.push(def.key);
      const { data: ins } = await context.supabase.from("assumptions").insert({
        project_id: data.project_id, owner_id: context.userId,
        field_key: def.key, field_label: def.label, category: def.category, unit: def.unit,
        status: "missing", confidence_score: 0, confidence_band: "missing",
        ai_reasoning: "Not found by deterministic extraction. Provide manually or upload more docs.",
      }).select().single();
      if (ins) await recordVersion(context, ins, "Created as missing", "Extraction Pipeline");
      auditEntries.push({ field_key: def.key, status: "missing" });
    }

    // The extraction report distinguishes extracted / calculated / missing tiers.
    const allMissingKeys = ASSUMPTION_DEFS
      .filter((def) => !grouped.has(def.key) && !calculatedKeys.includes(def.key) &&
        (!existingByKey.has(def.key) || existingByKey.get(def.key)?.status === "missing"))
      .map((def) => def.key);

    const reportMap = new Map(existingByKey);
    for (const key of grouped.keys()) reportMap.set(key, { field_key: key, status: conflictKeys.includes(key) ? "conflicting" : "extracted" });
    for (const key of calculatedKeys) reportMap.set(key, { field_key: key, status: "calculated" });
    const satisfiedRequired = new Set(requiredKeysSatisfiedBy(reportMap));
    const missingRequired = REQUIRED_KEYS.filter((key) => !satisfiedRequired.has(key) && allMissingKeys.includes(key));

    const debug = {
      project_id: data.project_id,
      analysis_mode: analysisMode,
      ai_used: analysisMode === "ai",
      ai_note: aiFailureReason,
      documents_seen: docs.length,
      documents_attempted: perDocument.length,
      documents_downloaded: documentsDownloaded,
      documents_failed: perDocument.filter((r) => !r.download_ok).length,
      per_document: perDocument,
      total_candidates: allCandidates.length,
      classified_count: classifiedCount,
      alias_mapped_count: deterministic.length,
      mapped_count: mapped.length,
      grouped_keys: Array.from(grouped.keys()),
      conflict_keys: conflictKeys,
      missing_keys: allMissingKeys,
      inserted_assumptions: insertedAssumptions,
      updated_assumptions: updatedAssumptions,
      skipped_docs: skippedDocs,
      warnings,
    };

    const report = {
      analysis_mode: analysisMode,
      ai_used: analysisMode === "ai",
      ai_note: aiFailureReason,
      stage1_candidates: allCandidates.length,
      stage2_classified: deterministic.length + classifiedCount,
      stage3_inferred_via_alias: deterministic.length,
      found: foundKeys.length,
      conflicting: conflictKeys.length,
      calculated: calculatedKeys.length,
      proposed_changes: proposedKeys.length,
      missing: allMissingKeys.length,
      missing_required: missingRequired.map((k) => ASSUMPTION_BY_KEY[k]?.label ?? k),
      conflicts: conflictKeys.map((k) => ASSUMPTION_BY_KEY[k]?.label ?? k),
      can_underwrite: missingRequired.length === 0 && conflictKeys.length === 0,
      entries: auditEntries,
      debug,
    };

    await auditLog(context, data.project_id, "project", data.project_id, "extract_assumptions", report);
    return report;
  });

// ---------- Approval workflow ----------

// Approval is the ONLY door into the engine: LLM-classified suggestions live
// in the review queue, and an analyst action propagates them here into the
// engine-readable tables with status='approved'.
import { TAXONOMY_TO_ENGINE_SCALAR, TAXONOMY_TO_BUDGET_CATEGORY, TAXONOMY_TO_REVENUE_FIELD } from "./taxonomy-engine-map";

async function propagateApprovedToEngine(ctx: any, a: any) {
  const value = a.value_numeric == null ? null : Number(a.value_numeric);
  const scalarKey = TAXONOMY_TO_ENGINE_SCALAR[a.field_key];
  if (scalarKey && value != null) {
    const { error } = await ctx.supabase.from("underwriting_inputs").upsert({
      project_id: a.project_id, owner_id: ctx.userId, key: scalarKey,
      value_numeric: value, source: "analyst", status: "approved",
      source_document_id: a.source_document_id ?? null,
      source_text: a.source_text ?? null,
      approved_by: ctx.userId, approved_at: new Date().toISOString(),
    }, { onConflict: "project_id,key" });
    if (error) throw new Error(`Failed to propagate ${a.field_key}: ${error.message}`);
    return;
  }
  const budgetCategory = TAXONOMY_TO_BUDGET_CATEGORY[a.field_key];
  if (budgetCategory && value != null) {
    // Scope the replace to THIS line (category + label) so multiple distinct
    // taxonomy keys that share a category (e.g. environmental reserve and tax
    // reassessment both map to "other") do not delete one another.
    await ctx.supabase.from("development_budget").delete()
      .eq("project_id", a.project_id).eq("category", budgetCategory).eq("label", a.field_label);
    const { error } = await ctx.supabase.from("development_budget").insert({
      project_id: a.project_id, owner_id: ctx.userId, category: budgetCategory,
      label: a.field_label, amount: value, source: "analyst", status: "approved",
      source_document_id: a.source_document_id ?? null, source_text: a.source_text ?? null,
    });
    if (error) throw new Error(`Failed to propagate ${a.field_key}: ${error.message}`);
    return;
  }
  const rev = TAXONOMY_TO_REVENUE_FIELD[a.field_key];
  if (rev && value != null) {
    const fieldCol = rev.field === "rent" ? "market_rent_monthly" : rev.field;
    // A project may transiently hold >1 row for a unit_type (re-parsed or
    // re-uploaded rent roll); .maybeSingle() would THROW on that. Fold any
    // duplicates into one engine-visible component instead of crashing or
    // silently forking a third zero-count row.
    const { data: existingRows } = await ctx.supabase.from("revenue_program").select("*")
      .eq("project_id", a.project_id).eq("unit_type", rev.unitType);
    const existing = existingRows?.[0] ?? null;
    if (existing) {
      const { error } = await ctx.supabase.from("revenue_program").update({
        [fieldCol]: value, status: "approved", source: "analyst",
      }).eq("id", existing.id);
      if (error) throw new Error(`Failed to propagate ${a.field_key}: ${error.message}`);
      if (existingRows && existingRows.length > 1) {
        await ctx.supabase.from("revenue_program").delete()
          .in("id", existingRows.slice(1).map((r: any) => r.id));
      }
    } else {
      // Partial components (rent or count still 0) are never engine-usable:
      // readiness requires count/SF AND rent before the row counts.
      const { error } = await ctx.supabase.from("revenue_program").insert({
        project_id: a.project_id, owner_id: ctx.userId,
        unit_type: rev.unitType, rent_basis: rev.basis,
        unit_count: rev.basis === "per_sf" ? 1 : 0,
        market_rent_monthly: 0,
        [fieldCol]: value,
        status: "approved", source: "analyst",
        source_document_id: a.source_document_id ?? null, source_text: a.source_text ?? null,
      });
      if (error) throw new Error(`Failed to propagate ${a.field_key}: ${error.message}`);
    }
  }
}

async function demoteEngineRows(ctx: any, a: any) {
  const scalarKey = TAXONOMY_TO_ENGINE_SCALAR[a.field_key];
  if (scalarKey) {
    await ctx.supabase.from("underwriting_inputs").update({ status: "rejected" })
      .eq("project_id", a.project_id).eq("key", scalarKey);
  }
  const budgetCategory = TAXONOMY_TO_BUDGET_CATEGORY[a.field_key];
  if (budgetCategory) {
    await ctx.supabase.from("development_budget").update({ status: "rejected" })
      .eq("project_id", a.project_id).eq("category", budgetCategory).eq("label", a.field_label);
  }
  const rev = TAXONOMY_TO_REVENUE_FIELD[a.field_key];
  if (rev) {
    // Clear the specific field rather than nuking the whole component on a
    // single-field rejection: zeroed count/rent make the component
    // engine-incomplete (readiness drops it); occupancy reverts to fallback.
    const fieldCol = rev.field === "rent" ? "market_rent_monthly" : rev.field;
    const cleared = rev.field === "occupancy_pct" ? null : 0;
    await ctx.supabase.from("revenue_program").update({ [fieldCol]: cleared })
      .eq("project_id", a.project_id).eq("unit_type", rev.unitType);
  }
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "modify", "reject", "needs_review"]),
  value_numeric: z.number().nullable().optional(),
  value_text: z.string().nullable().optional(),
  change_reason: z.string().max(1000).optional(),
});

export const reviewAssumption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: cur, error } = await context.supabase
      .from("assumptions").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const by = await userName(context);
    const newVer = cur.current_version + 1;
    const patch: any = { current_version: newVer };
    if (data.action === "approve" && cur.status === "conflicting") {
      throw new Error(
        "This key has conflicting extracted values. Resolve the conflict (pick one of the documented values or use the conservative option) instead of approving.",
      );
    }
    if (data.action === "approve") {
      patch.status = "approved";
      patch.approved_by = context.userId;
      patch.approved_at = new Date().toISOString();
    } else if (data.action === "modify") {
      // A conflicting key may only be modified to one of the documented
      // candidate values: never an invented number (mirrors resolveConflict).
      if (cur.status === "conflicting") {
        const candidates = ((cur as any).conflict_values ?? [])
          .map((c: any) => Number(c.value))
          .filter((v: number) => Number.isFinite(v));
        if (data.value_numeric == null || !candidates.some((c: number) => Math.abs(c - (data.value_numeric as number)) < 1e-9)) {
          throw new Error(
            `This key has conflicting extracted values. A modification must equal one of the documented candidates (${candidates.join(", ")}); use "resolve conflict" for a conservative value instead of inventing one.`,
          );
        }
      }
      patch.status = "modified";
      patch.value_numeric = data.value_numeric ?? cur.value_numeric;
      patch.value_text = data.value_text ?? cur.value_text;
      patch.approved_by = context.userId;
      patch.approved_at = new Date().toISOString();
      // Modified values get high confidence (human-entered)
      patch.confidence_score = 100;
      patch.confidence_band = "high";
    } else if (data.action === "reject") {
      patch.status = "rejected";
    } else {
      patch.status = "needs_review";
    }
    const { data: upd, error: uErr } = await context.supabase.from("assumptions").update(patch).eq("id", data.id).select().single();
    if (uErr) throw new Error(uErr.message);
    await recordVersion(context, upd, data.change_reason || `Status set to ${upd.status} by ${by}`, by);
    await auditLog(context, cur.project_id, "assumption", cur.id, `assumption_${data.action}`, {
      from: { value_numeric: cur.value_numeric, value_text: cur.value_text, status: cur.status },
      to: { value_numeric: upd.value_numeric, value_text: upd.value_text, status: upd.status },
      reason: data.change_reason ?? null,
    });
    // Approval propagates into the engine-readable tables; rejection demotes.
    if (upd.status === "approved" || upd.status === "modified") {
      await propagateApprovedToEngine(context, upd);
    } else if (upd.status === "rejected") {
      await demoteEngineRows(context, upd);
    }
    return upd;
  });

// ---------- Financial engine ----------
//
// REMOVED. The duplicate ad-hoc model (buildModel/recomputeOutputs) that read
// blended occupancy, applied silent `|| 95`-style defaults, and approximated
// IRR geometrically has been deleted: not gated, removed. All underwriting,
// pro-forma, scenario, DSCR, IRR and risk-score values are produced solely by
// runFullUnderwriting (underwriting.functions.ts) over the deterministic
// engine in src/lib/engine, fed exclusively by approved/default_accepted rows.

// ---------- Decision log ----------

export const recordDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    project_id: z.string().uuid(),
    decision: z.enum(["approve", "approve_with_conditions", "return_to_underwriting", "reject"]),
    rationale: z.string().max(5000),
    conditions: z.string().max(5000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const by = await userName(context);
    const { data: row, error } = await context.supabase.from("decision_logs").insert({
      project_id: data.project_id, owner_id: context.userId, user_id: context.userId, user_name: by,
      decision: data.decision, rationale: data.rationale, conditions: data.conditions ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    await auditLog(context, data.project_id, "decision", row.id, "ic_decision", { decision: data.decision });
    return row;
  });

// ---------- Readiness ----------

export const getReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("assumptions")
      .select("field_key,status,confidence_score,confidence_band").eq("project_id", data.project_id);
    const map = new Map((rows ?? []).map((r) => [r.field_key, r]));
    const required = ASSUMPTION_DEFS.filter((d) => d.required);
    const total = ASSUMPTION_DEFS.length;
    const approved = (rows ?? []).filter((r) => r.status === "approved" || r.status === "modified").length;
    const satisfiedRequired = new Set(requiredKeysSatisfiedBy(map));
    const missingReq = required.filter((d) => !satisfiedRequired.has(d.key));
    const avgConfidence = (rows ?? []).reduce((s, r) => s + (r.confidence_score || 0), 0) / Math.max(rows?.length ?? 1, 1);
    const completenessPct = Math.round((approved / total) * 100);
    const requiredPct = Math.round(((required.length - missingReq.length) / required.length) * 100);
    const score = Math.round(0.6 * requiredPct + 0.3 * completenessPct + 0.1 * avgConfidence);
    return { score, approved, total, missing_required: missingReq.map((d) => d.label), avg_confidence: Math.round(avgConfidence), completeness_pct: completenessPct, required_pct: requiredPct };
  });
