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

  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        // TanStack Start server-side cookie handling
        return [];
      },
      setAll(cookiesToSet) {
        // TanStack Start server-side cookie handling
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Handle cookie setting in TanStack context
          });
        } catch {
          // Cookie setting from Server Component
          // Can be ignored if middleware is refreshing sessions
        }
      },
    },
  });
};
