(function () {
  'use strict';

  const CHECKOUT_KEY_PREFIX = 'triaxis_checkout_v1:';

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
    if (checkoutUrl.protocol !== 'https:' || !(checkoutUrl.hostname === 'mercadopago.com' || checkoutUrl.hostname.endsWith('.mercadopago.com'))) {
      throw new Error('PAYMENT_CHECKOUT_URL_INVALID');
    }
    return checkoutUrl.href;
  }

  function consumeReturnNotice() {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('payment');
    if (!['success', 'pending', 'failure'].includes(status)) return null;
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
    return status;
  }

  window.TriAxisPayments = Object.freeze({ createCheckout, consumeReturnNotice });
})();
