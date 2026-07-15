#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "[property-search-cleanup] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const result = await supabase.rpc("cleanup_property_search_sessions", { p_limit: 5000 });
if (result.error) throw new Error(result.error.message);
console.log(
  JSON.stringify({
    component: "property-search-cleanup",
    status: "ok",
    removed_sessions: Number(result.data ?? 0),
    bounded: true,
  }),
);
