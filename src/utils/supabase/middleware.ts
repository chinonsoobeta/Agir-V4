import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/integrations/supabase/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

export const createClient = () => {
  if (!supabaseUrl || !supabaseKey) {
    const missing = [
      ...(!supabaseUrl ? ['SUPABASE_URL'] : []),
      ...(!supabaseKey ? ['SUPABASE_ANON_KEY'] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(', ')}`);
  }

  // TanStack Start middleware for session refresh
  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll(cookiesToSet) {
        // Handle cookie updates for session refresh
        cookiesToSet.forEach(({ name, value, options }) => {
          // Session update handling
        });
      },
    },
  });
};
