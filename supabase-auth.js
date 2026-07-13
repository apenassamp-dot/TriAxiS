(function () {
  'use strict';

  let client = null;
  let changeHandler = null;
  let currentState = Object.freeze({ session: null, profile: null, roles: [] });

  function requireClient() {
    if (!client) throw new Error('SUPABASE_NOT_INITIALIZED');
    return client;
  }

  function publishState(nextState) {
    currentState = Object.freeze({
      session: nextState?.session || null,
      profile: nextState?.profile || null,
      roles: Object.freeze(Array.isArray(nextState?.roles) ? [...nextState.roles] : [])
    });
    if (typeof changeHandler === 'function') changeHandler(currentState);
    return currentState;
  }

  async function loadAuthenticatedState(session) {
    if (!session?.user?.id) return publishState({ session: null, profile: null, roles: [] });

    const api = requireClient();
    const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }] = await Promise.all([
      api.from('profiles').select('id, display_name, phone, tag, status, avatar_path, created_at, updated_at').eq('id', session.user.id).single(),
      api.from('user_roles').select('role').eq('user_id', session.user.id)
    ]);

    if (profileError) throw profileError;
    if (rolesError) throw rolesError;

    return publishState({
      session,
      profile,
      roles: (roleRows || []).map((row) => row.role).filter(Boolean)
    });
  }

  async function initialize(onChange) {
    const config = window.TRIAXIS_SUPABASE_CONFIG;
    if (!config?.url || !config?.publishableKey) throw new Error('SUPABASE_CONFIG_MISSING');
    if (!window.supabase?.createClient) throw new Error('SUPABASE_SDK_MISSING');

    changeHandler = typeof onChange === 'function' ? onChange : null;
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    await loadAuthenticatedState(data?.session || null);

    client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        loadAuthenticatedState(session).catch((error) => {
          console.error('Falha ao atualizar sessão Supabase:', error);
          publishState({ session: null, profile: null, roles: [] });
        });
      }, 0);
    });

    return currentState;
  }

  async function signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password: String(password || '')
    });
    if (error) throw error;
    return loadAuthenticatedState(data.session);
  }

  async function signUp({ email, password, displayName, phone }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const emailParts = normalizedEmail.split('@');
    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      /\s/.test(normalizedEmail) ||
      emailParts.length !== 2 ||
      !emailParts[0] ||
      !emailParts[1]?.includes('.') ||
      emailParts[1].startsWith('.') ||
      emailParts[1].endsWith('.')
    ) throw new Error('INVALID_SIGNUP_EMAIL');

    const { data, error } = await requireClient().auth.signUp({
      email: normalizedEmail,
      password: String(password || ''),
      options: {
        data: {
          display_name: String(displayName || '').trim(),
          phone: String(phone || '').trim()
        }
      }
    });
    if (error) throw error;
    if (data.session) await loadAuthenticatedState(data.session);
    return { user: data.user || null, session: data.session || null };
  }

  async function signOut() {
    const { error } = await requireClient().auth.signOut();
    if (error) throw error;
    return publishState({ session: null, profile: null, roles: [] });
  }

  window.TriAxisAuth = Object.freeze({
    initialize,
    signIn,
    signUp,
    signOut,
    getState: () => currentState,
    isAdmin: () => currentState.roles.includes('admin'),
    isStaff: () => currentState.roles.some((role) => ['admin', 'production', 'support'].includes(role))
  });
})();
