import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { supabase, MOCK_MODE } from './supabase.js';
import { makePerms } from './perms.js';
import { mockSignIn, mockRestore, mockSignOut, permissionsFor, DEMO_USERS } from './mock.js';
import { api } from './api.js';

const AuthContext = createContext(null);

export const DEMO_CHIPS = DEMO_USERS.map((u) => ({
  email: u.email,
  password: u.password,
  role: u.role,
  label: u.role[0].toUpperCase() + u.role.slice(1),
  scope: u.scope_regions.length ? u.scope_regions.join(', ') : 'All regions',
}));

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState(() => readTheme());

  useEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    let cancelled = false;

    if (MOCK_MODE) {
      setSession(mockRestore());
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session ? await hydrate(data.session) : null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (cancelled) return;
      setSession(s ? await hydrate(s) : null);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (MOCK_MODE) { setSession(mockSignIn(email, password)); return; }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setSession(await hydrate(data.session));
  }, []);

  const signUp = useCallback(async (email, password, fullName) => {
    if (MOCK_MODE) {
      // Signup needs a mail server; in fixture mode it stops at the same neutral
      // "check your email" state the real flow shows, and never claims more.
      return { pending: true };
    }
    const { error } = await supabase.auth.signUp({
      email, password, options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    return { pending: true };
  }, []);

  const signOut = useCallback(async () => {
    if (MOCK_MODE) { mockSignOut(); setSession(null); return; }
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try { localStorage.setItem('theme', next); } catch {}
    // localStorage is a cache; the server value from settings wins on arrival.
    api('/settings', { method: 'PUT', body: { user: { theme: next } }, idempotencyKey: crypto.randomUUID() })
      .catch(() => {});
  }, []);

  const value = useMemo(() => ({
    session,
    loading,
    user: session?.user || null,
    profile: session?.profile || null,
    perms: makePerms(session?.permissions || []),
    theme,
    setTheme,
    signIn, signUp, signOut,
  }), [session, loading, theme, setTheme, signIn, signUp, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Turns a Supabase session into the shape the whole UI reads. */
async function hydrate(s) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, scope_regions, scope_categories, roles(key, name)')
    .eq('user_id', s.user.id)
    .single();

  const roleKey = profile?.roles?.key || 'viewer';
  const { data: grants } = await supabase
    .from('role_permissions')
    .select('permissions(module, action), roles!inner(key)')
    .eq('roles.key', roleKey);

  return {
    user: s.user,
    accessToken: s.access_token,
    profile: {
      full_name: profile?.full_name || s.user.email,
      role_key: roleKey,
      role_name: profile?.roles?.name || 'Viewer',
      scope_regions: profile?.scope_regions || [],
      scope_categories: profile?.scope_categories || [],
    },
    permissions: (grants || []).map((g) => `${g.permissions.module}.${g.permissions.action}`),
  };
}

function readTheme() {
  try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; }
}

export function applyTheme(theme) {
  const dark = theme === 'dark' ||
    (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

export { permissionsFor };
