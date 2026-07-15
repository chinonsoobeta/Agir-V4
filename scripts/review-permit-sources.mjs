#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^['"]|['"]$/g, "");
  }
}
loadLocalEnv();

if (process.argv.includes("--local")) {
  const local = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
  const values = Object.fromEntries(
    local
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
  process.env.SUPABASE_URL = values.API_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = values.SERVICE_ROLE_KEY;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const write = process.argv.includes("--write");
const supabase = createClient(url, key, { auth: { persistSession: false } });
const now = new Date();
function canonicalSourceText(input) {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100_000);
}
let ruleQuery = supabase
  .from("permit_rules")
  .select("id,name,official_source_url,source_content_hash,next_review_at")
  .is("superseded_at", null)
  .not("official_source_url", "is", null)
  .limit(200);
if (!process.argv.includes("--all")) {
  ruleQuery = ruleQuery.or(`next_review_at.is.null,next_review_at.lte.${now.toISOString()}`);
}
const { data: rules, error } = await ruleQuery;
if (error) throw new Error(error.message);

let changed = 0;
let unavailable = 0;
const sourceCache = new Map();
for (const rule of rules ?? []) {
  let status = "verified";
  let hash = null;
  let sourceText = null;
  let notes = null;
  try {
    let observed = sourceCache.get(rule.official_source_url);
    if (!observed) {
      const response = await fetch(rule.official_source_url, {
        headers: { "user-agent": "AgirPermitSourceMonitor/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      sourceText = canonicalSourceText(await response.text());
      observed = {
        sourceText,
        hash: createHash("sha256").update(sourceText).digest("hex"),
        httpStatus: response.status,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
      sourceCache.set(rule.official_source_url, observed);
    }
    sourceText = observed.sourceText;
    hash = observed.hash;
    if (rule.source_content_hash && rule.source_content_hash !== hash) {
      status = "changed";
      changed += 1;
    }
  } catch (cause) {
    status = "unavailable";
    unavailable += 1;
    notes = cause instanceof Error ? cause.message : String(cause);
  }
  console.log(`${status.padEnd(11)} ${rule.name} ${rule.official_source_url}`);
  if (!write) continue;
  const nextReview = new Date(now);
  nextReview.setUTCMonth(nextReview.getUTCMonth() + (status === "verified" ? 6 : 1));
  const review = await supabase.from("permit_rule_reviews").insert({
    permit_rule_id: rule.id,
    review_status: status,
    source_url: rule.official_source_url,
    source_text: sourceText?.slice(0, 10_000) ?? null,
    source_content_hash: hash,
    next_review_at: nextReview.toISOString(),
    notes,
  });
  if (review.error) throw new Error(review.error.message);
  const patch =
    status === "verified"
      ? {
          source_content_hash: hash,
          next_review_at: nextReview.toISOString(),
          review_date: now.toISOString().slice(0, 10),
        }
      : { next_review_at: nextReview.toISOString(), verification_status: "needs_review" };
  const update = await supabase.from("permit_rules").update(patch).eq("id", rule.id);
  if (update.error) throw new Error(update.error.message);
}

const municipalResult = await supabase
  .from("municipal_research_sources")
  .select("id,source_title,source_url,last_observed_hash,next_check_at,consecutive_failures")
  .order("source_title")
  .limit(100);
if (municipalResult.error) throw new Error(municipalResult.error.message);
let municipalChecked = 0;
for (const source of municipalResult.data ?? []) {
  if (
    !process.argv.includes("--all") &&
    source.next_check_at &&
    new Date(source.next_check_at) > now
  )
    continue;
  municipalChecked += 1;
  let status = "current";
  let observed = sourceCache.get(source.source_url);
  let errorDetail = null;
  try {
    if (!observed) {
      const response = await fetch(source.source_url, {
        headers: { "user-agent": "AgirMunicipalSourceMonitor/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sourceText = canonicalSourceText(await response.text());
      observed = {
        sourceText,
        hash: createHash("sha256").update(sourceText).digest("hex"),
        httpStatus: response.status,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
      sourceCache.set(source.source_url, observed);
    }
    if (source.last_observed_hash && source.last_observed_hash !== observed.hash) {
      status = "changed";
      changed += 1;
    }
  } catch (cause) {
    status = "unavailable";
    unavailable += 1;
    errorDetail = cause instanceof Error ? cause.message : String(cause);
  }
  console.log(`${status.padEnd(11)} municipal source ${source.source_title} ${source.source_url}`);
  if (!write) continue;
  const snapshot = await supabase.from("municipal_source_snapshots").insert({
    source_id: source.id,
    observation_status: status,
    http_status: observed?.httpStatus ?? null,
    content_hash: observed?.hash ?? null,
    content_excerpt: observed?.sourceText?.slice(0, 10_000) ?? null,
    etag: observed?.etag ?? null,
    last_modified: observed?.lastModified ?? null,
    error_detail: errorDetail,
  });
  if (snapshot.error) throw new Error(snapshot.error.message);
  const nextCheck = new Date(now);
  nextCheck.setUTCDate(nextCheck.getUTCDate() + (status === "current" ? 90 : 7));
  const sourceUpdate = await supabase
    .from("municipal_research_sources")
    .update({
      integrity_status: status,
      last_observed_at: now.toISOString(),
      ...(observed?.hash ? { last_observed_hash: observed.hash } : {}),
      next_check_at: nextCheck.toISOString(),
      consecutive_failures:
        status === "unavailable" ? Number(source.consecutive_failures ?? 0) + 1 : 0,
    })
    .eq("id", source.id);
  if (sourceUpdate.error) throw new Error(sourceUpdate.error.message);
}

console.log(
  JSON.stringify(
    {
      checked: rules?.length ?? 0,
      municipal_checked: municipalChecked,
      changed,
      unavailable,
      write,
    },
    null,
    2,
  ),
);
if (changed || unavailable) process.exitCode = 2;
