import { createClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "./config";

export function getSupabaseAdminClient() {
  const { url, secretKey } = getSupabaseEnv();

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
