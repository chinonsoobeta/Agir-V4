import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/integrations/supabase/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const createClient = () => {
  if (!supabaseUrl || !supabaseKey) {
    const missing = [
      ...(!supabaseUrl ? ['SUPABASE_URL'] : []),
      ...(!supabaseKey ? ['SUPABASE_ANON_KEY'] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(', ')}`);
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
};
