(function () {
  'use strict';

  let client = null;
  let changeHandler = null;
  let authEventHandler = null;
  let currentState = Object.freeze({ session: null, profile: null, roles: [] });
  let authGeneration = 0;
  let activeLoad = null;

  // Keep bursts of Supabase traffic from exhausting the browser connection
  // pool or triggering avoidable API throttling. The queue is intentionally
  // small so a stalled page fails fast instead of growing unbounded memory.
  const REQUEST_MIN_INTERVAL_MS = 150;
  const REQUEST_MAX_CONCURRENT = 4;
  const REQUEST_MAX_QUEUE = 40;
  const REQUEST_MAX_RETRIES = 2;
  const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
  const requestQueue = [];
  let activeRequests = 0;
  let lastRequestStartedAt = 0;

  function retryDelay(response, attempt) {
    const retryAfter = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 8000);
    return Math.min(500 * (2 ** attempt), 4000);
  }

  function pumpRequestQueue() {
    while (activeRequests < REQUEST_MAX_CONCURRENT && requestQueue.length) {
      const task = requestQueue.shift();
      activeRequests += 1;
      const scheduledStartAt = Math.max(Date.now(), lastRequestStartedAt + REQUEST_MIN_INTERVAL_MS);
      const wait = Math.max(0, scheduledStartAt - Date.now());
      lastRequestStartedAt = scheduledStartAt;
      window.setTimeout(async () => {
        try {
          const method = String(task.init?.method || 'GET').toUpperCase();
          const canRetry = ['GET', 'HEAD', 'OPTIONS'].includes(method);
          let response;
          for (let attempt = 0; ; attempt += 1) {
            response = await task.baseFetch(task.input, task.init);
            if (!canRetry || !RETRYABLE_STATUS.has(response.status) || attempt >= REQUEST_MAX_RETRIES) break;
            await new Promise((resolve) => window.setTimeout(resolve, retryDelay(response, attempt)));
          }
          task.resolve(response);
        } catch (error) {
          task.reject(error);
        } finally {
          activeRequests -= 1;
          pumpRequestQueue();
        }
      }, wait);
    }
  }

  function rateLimitedFetch(input, init = {}) {
    return new Promise((resolve, reject) => {
      if (requestQueue.length >= REQUEST_MAX_QUEUE) {
        reject(new Error('SUPABASE_REQUEST_QUEUE_FULL'));
        return;
      }
      requestQueue.push({ input, init, resolve, reject, baseFetch: window.fetch.bind(window) });
      pumpRequestQueue();
    });
  }

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

  function sessionKey(session) {
    return session?.user?.id ? `${session.user.id}:${session.access_token || ''}` : 'signed-out';
  }

  async function loadAuthenticatedState(session, generation) {
    const api = requireClient();
    const inputUserId = session?.user?.id || null;
    if (!inputUserId) {
      const { data, error } = await api.auth.getSession();
      if (error) throw error;
      if (generation !== authGeneration || data?.session?.user?.id) return currentState;
      return publishState({ session: null, profile: null, roles: [] });
    }

    const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }] = await Promise.all([
      api.from('profiles').select('id, display_name, phone, tag, status, avatar_path, created_at, updated_at').eq('id', inputUserId).single(),
      api.from('user_roles').select('role').eq('user_id', inputUserId)
    ]);
    if (generation !== authGeneration) return currentState;
    if (profileError) throw profileError;
    if (rolesError) throw rolesError;

    const { data: activeData, error: sessionError } = await api.auth.getSession();
    if (sessionError) throw sessionError;
    if (generation !== authGeneration || activeData?.session?.user?.id !== inputUserId) return currentState;
    return publishState({
      session: activeData.session,
      profile,
      roles: profile?.status === 'active' ? (roleRows || []).map((row) => row.role).filter(Boolean) : []
    });
  }

  function requestSessionLoad(session, options = {}) {
    const key = sessionKey(session);
    if (!options.force && activeLoad?.key === key) return activeLoad.promise;
    if (!options.force && session?.user?.id && currentState.session?.user?.id === session.user.id && currentState.session?.access_token === session.access_token) {
      return Promise.resolve(currentState);
    }
    const generation = ++authGeneration;
    const promise = loadAuthenticatedState(session, generation)
      .catch(async (error) => {
        if (generation !== authGeneration) return currentState;
        try { await requireClient().auth.getSession(); } catch (sessionError) {}
        if (generation === authGeneration) publishState({ session: null, profile: null, roles: [] });
        throw error;
      })
      .finally(() => {
        if (activeLoad?.generation === generation) activeLoad = null;
      });
    activeLoad = { key, generation, promise };
    return promise;
  }

  async function initialize(onChange, onAuthEvent, options = {}) {
    const config = window.TRIAXIS_SUPABASE_CONFIG;
    if (!config?.url || !config?.publishableKey) throw new Error('SUPABASE_CONFIG_MISSING');
    if (!window.supabase?.createClient) throw new Error('SUPABASE_SDK_MISSING');

    changeHandler = typeof onChange === 'function' ? onChange : null;
    authEventHandler = typeof onAuthEvent === 'function' ? onAuthEvent : null;
    client = window.supabase.createClient(config.url, config.publishableKey, {
      global: { fetch: rateLimitedFetch },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: options.detectSessionInUrl !== false
      }
    });

    client.auth.onAuthStateChange((event, session) => {
      const previousState = currentState;
      const safeTokenRefresh = event === 'TOKEN_REFRESHED' && session?.user?.id === previousState.session?.user?.id && previousState.profile;
      const identityChanged = !safeTokenRefresh && sessionKey(session) !== sessionKey(previousState.session);
      const eventGeneration = ++authGeneration;
      activeLoad = null;
      if (identityChanged) publishState({ session: null, profile: null, roles: [] });
      if (authEventHandler) {
        try {
          authEventHandler(event, session);
        } catch (error) {
          console.error('Falha ao processar evento de autenticação:', error);
        }
      }
      if (safeTokenRefresh) {
        publishState({ session, profile: previousState.profile, roles: previousState.roles });
        return;
      }
      window.setTimeout(() => {
        if (eventGeneration !== authGeneration) return;
        requestSessionLoad(session, { force: event === 'USER_UPDATED' }).catch((error) => {
          console.error('Falha ao atualizar sessão Supabase:', error);
        });
      }, 0);
    });

    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    await requestSessionLoad(data?.session || null);

    return currentState;
  }

  async function signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password: String(password || '')
    });
    if (error) throw error;
    return requestSessionLoad(data.session);
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
    if (data.session) await requestSessionLoad(data.session);
    return { user: data.user || null, session: data.session || null };
  }

  async function signOut() {
    ++authGeneration;
    activeLoad = null;
    publishState({ session: null, profile: null, roles: [] });
    try {
      const { error } = await requireClient().auth.signOut();
      if (error) throw error;
      return currentState;
    } finally {
      try { await requireClient().auth.signOut({ scope: 'local' }); } catch (localError) {}
      ++authGeneration;
      activeLoad = null;
      publishState({ session: null, profile: null, roles: [] });
    }
  }

  async function requestPasswordReset(email, redirectTo) {
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
    ) throw new Error('INVALID_RECOVERY_EMAIL');

    const destination = new URL(String(redirectTo || ''), window.location.href);
    if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('INVALID_RECOVERY_REDIRECT');
    if (destination.origin !== window.location.origin) throw new Error('INVALID_RECOVERY_REDIRECT');
    destination.search = '';
    destination.hash = '';

    const { error } = await requireClient().auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: destination.href
    });
    if (error) throw error;
  }

  function isValidRecoveryCredential(value) {
    const normalized = String(value || '').trim();
    return normalized.length >= 8 && normalized.length <= 4096 && /^[A-Za-z0-9._~+/=-]+$/.test(normalized);
  }

  async function restorePreviousSession(previousSession) {
    const api = requireClient();
    let activeSession = null;
    try {
      const { data } = await api.auth.getSession();
      activeSession = data?.session || null;
    } catch (error) {}
    if (
      activeSession?.user?.id === previousSession?.user?.id &&
      activeSession?.access_token === previousSession?.access_token
    ) return;

    if (previousSession?.access_token && previousSession?.refresh_token) {
      const { data, error } = await api.auth.setSession({
        access_token: previousSession.access_token,
        refresh_token: previousSession.refresh_token
      });
      if (error || !data?.session?.user?.id) throw error || new Error('PREVIOUS_SESSION_RESTORE_FAILED');
      await requestSessionLoad(data.session);
      return;
    }

    const { error } = await api.auth.signOut({ scope: 'local' });
    if (error) throw error;
    await requestSessionLoad(null);
  }

  async function runRecoverySessionExchange(exchange) {
    const previousSession = currentState.session || null;
    try {
      const session = await exchange(requireClient());
      if (!session?.user?.id) throw new Error('RECOVERY_SESSION_MISSING');
      return requestSessionLoad(session);
    } catch (error) {
      try {
        await restorePreviousSession(previousSession);
      } catch (restoreError) {
        console.error('Falha ao restaurar sessão anterior após link inválido:', restoreError);
      }
      throw error;
    }
  }

  async function exchangeRecoveryCode(code) {
    const normalizedCode = String(code || '').trim();
    if (!isValidRecoveryCredential(normalizedCode)) throw new Error('INVALID_RECOVERY_CODE');
    return runRecoverySessionExchange(async (api) => {
      const { data, error } = await api.auth.exchangeCodeForSession(normalizedCode);
      if (error) throw error;
      return data?.session || null;
    });
  }

  async function setRecoverySession(accessToken, refreshToken) {
    const normalizedAccessToken = String(accessToken || '').trim();
    const normalizedRefreshToken = String(refreshToken || '').trim();
    if (!isValidRecoveryCredential(normalizedAccessToken) || !isValidRecoveryCredential(normalizedRefreshToken)) {
      throw new Error('INVALID_RECOVERY_SESSION_TOKENS');
    }
    return runRecoverySessionExchange(async (api) => {
      const { data, error } = await api.auth.setSession({
        access_token: normalizedAccessToken,
        refresh_token: normalizedRefreshToken
      });
      if (error) throw error;
      return data?.session || null;
    });
  }

  async function verifyRecoveryTokenHash(tokenHash) {
    const normalizedTokenHash = String(tokenHash || '').trim();
    if (!isValidRecoveryCredential(normalizedTokenHash)) throw new Error('INVALID_RECOVERY_TOKEN_HASH');
    return runRecoverySessionExchange(async (api) => {
      const { data, error } = await api.auth.verifyOtp({
        token_hash: normalizedTokenHash,
        type: 'recovery'
      });
      if (error) throw error;
      let session = data?.session || null;
      if (!session?.user?.id) {
        const { data: sessionData, error: sessionError } = await api.auth.getSession();
        if (sessionError) throw sessionError;
        session = sessionData?.session || null;
      }
      return session;
    });
  }

  async function updatePassword(password) {
    const normalizedPassword = String(password || '');
    if (normalizedPassword.length < 8 || normalizedPassword.length > 72) throw new Error('INVALID_RECOVERY_PASSWORD');
    if (!currentState.session?.user?.id) throw new Error('RECOVERY_SESSION_MISSING');
    const { data, error } = await requireClient().auth.updateUser({ password: normalizedPassword });
    if (error) throw error;
    return data?.user || null;
  }

  window.TriAxisAuth = Object.freeze({
    initialize,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    exchangeRecoveryCode,
    setRecoverySession,
    verifyRecoveryTokenHash,
    updatePassword,
    getClient: () => requireClient(),
    getState: () => currentState,
    isAdmin: () => currentState.roles.includes('admin'),
    canAccessProduction: () => currentState.roles.some((role) => ['admin', 'production'].includes(role)),
    isStaff: () => currentState.roles.some((role) => ['admin', 'production', 'support'].includes(role))
  });
})();
