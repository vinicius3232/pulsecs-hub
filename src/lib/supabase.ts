import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const isSupabaseConfigured = () => {
  return (
    Boolean((import.meta as any).env?.VITE_SUPABASE_URL) &&
    Boolean((import.meta as any).env?.VITE_SUPABASE_ANON_KEY)
  );
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
