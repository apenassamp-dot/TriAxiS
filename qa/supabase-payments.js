(function () {
  'use strict';

  const CHECKOUT_KEY_PREFIX = 'triaxis_checkout_v1:';
  const PAYMENT_RETURN_KEY = 'triaxis_payment_return_v1';
  const PAYMENT_RETURN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function requireClient() {
    if (!window.TriAxisAuth?.getClient) throw new Error('PAYMENTS_AUTH_NOT_INITIALIZED');
    if (!window.TriAxisAuth?.getState?.()?.session?.user?.id) throw new Error('PAYMENTS_AUTH_REQUIRED');
    return window.TriAxisAuth.getClient();
  }

  function checkoutRequestKey(orderId) {
    const userId = window.TriAxisAuth?.getState?.()?.session?.user?.id;
    const key = `${CHECKOUT_KEY_PREFIX}${userId}:${orderId}`;
    let stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (error) {}
    let requestKey = stored?.requestKey;
    const expired = !stored?.createdAt || Date.now() - Date.parse(stored.createdAt) > 35 * 60 * 1000;
    if (!/^[0-9a-f-]{36}$/i.test(requestKey || '') || expired) {
      requestKey = crypto.randomUUID();
      sessionStorage.setItem(key, JSON.stringify({ requestKey, createdAt: new Date().toISOString() }));
    }
    return requestKey;
  }

  async function createCheckout(orderId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) throw new Error('PAYMENT_ORDER_INVALID');
    const { data, error } = await requireClient().functions.invoke('create-mercadopago-preference', {
      body: { orderId, requestKey: checkoutRequestKey(orderId) }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    let checkoutUrl;
    try { checkoutUrl = new URL(data?.checkoutUrl); } catch (error) { throw new Error('PAYMENT_CHECKOUT_URL_INVALID'); }
    const hostname = checkoutUrl.hostname.toLowerCase();
    const officialHost = hostname === 'mercadopago.com'
      || hostname.endsWith('.mercadopago.com')
      || hostname === 'mercadopago.com.br'
      || hostname.endsWith('.mercadopago.com.br');
    if (checkoutUrl.protocol !== 'https:' || !officialHost) {
      throw new Error('PAYMENT_CHECKOUT_URL_INVALID');
    }
    return checkoutUrl.href;
  }

  function readReturnNotice() {
    try {
      const notice = JSON.parse(localStorage.getItem(PAYMENT_RETURN_KEY) || 'null');
      const recordedAt = Date.parse(notice?.recordedAt || '');
      if (!['success', 'pending', 'failure'].includes(notice?.status) ||
        !Number.isFinite(recordedAt) ||
        Date.now() - recordedAt > PAYMENT_RETURN_TTL_MS) {
        localStorage.removeItem(PAYMENT_RETURN_KEY);
        return null;
      }
      return notice;
    } catch (error) {
      try { localStorage.removeItem(PAYMENT_RETURN_KEY); } catch (storageError) {}
      return null;
    }
  }

  function persistReturnNotice(status, url) {
    const externalReference = url.searchParams.get('external_reference') || '';
    const paymentId = url.searchParams.get('payment_id') || url.searchParams.get('collection_id') || '';
    const notice = {
      status,
      transactionReference: /^[0-9a-f-]{36}$/i.test(externalReference) ? externalReference : '',
      paymentId: /^\d{1,32}$/.test(paymentId) ? paymentId : '',
      recordedAt: new Date().toISOString()
    };
    try { localStorage.setItem(PAYMENT_RETURN_KEY, JSON.stringify(notice)); } catch (error) {}
    return notice;
  }

  function consumeReturnNotice() {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('payment');
    if (!['success', 'pending', 'failure'].includes(status)) {
      const storedNotice = readReturnNotice();
      return storedNotice ? { ...storedNotice, fresh: false } : null;
    }
    const notice = persistReturnNotice(status, url);
    if (status === 'failure') {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(CHECKOUT_KEY_PREFIX)) sessionStorage.removeItem(key);
      }
    }
    [
      'payment', 'collection_id', 'collection_status', 'payment_id', 'status',
      'external_reference', 'payment_type', 'merchant_order_id', 'preference_id',
      'site_id', 'processing_mode', 'merchant_account_id'
    ].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    return { ...notice, fresh: true };
  }

  function clearReturnNotice() {
    try { localStorage.removeItem(PAYMENT_RETURN_KEY); } catch (error) {}
  }

  window.TriAxisPayments = Object.freeze({
    createCheckout,
    consumeReturnNotice,
    getReturnNotice: readReturnNotice,
    clearReturnNotice
  });
})();
