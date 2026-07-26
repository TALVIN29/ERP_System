import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when no Supabase project is wired up yet. The app then runs entirely on
 *  local fixtures so the UI is demoable before any infrastructure exists. */
export const MOCK_MODE = import.meta.env.DEV && (!url || !anonKey || url.includes('YOUR_PROJECT'));

export const supabase = MOCK_MODE
  ? null
  : createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
