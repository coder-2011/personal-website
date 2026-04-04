export function getSupabaseEnv() {
  const url = import.meta.env.SUPABASE_URL;
  const secretKey = import.meta.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY."
    );
  }

  return { url, secretKey };
}
