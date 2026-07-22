(function () {
  'use strict';

  const STATUS_LABELS = Object.freeze({
    order_received: 'Pedido recebido',
    awaiting_payment: 'Aguardando comprovação',
    payment_received: 'Comprovação recebida',
    payment_validation: 'Em validação',
    approved_for_production: 'Aprovado para produção',
    in_production: 'Em produção',
    ready: 'Pronto',
    shipped: 'Enviado',
    available_for_pickup: 'Disponível para retirada',
    delivered: 'Entregue',
    rejected: 'Rejeitado',
    cancelled: 'Cancelado',
    blocked: 'Bloqueado',
    refund_pending: 'Reembolso pendente',
    refunded: 'Reembolsado',
    production_suspended: 'Produção suspensa',
    delivery_issue: 'Entrega com problema'
  });
  const LABEL_STATUSES = Object.freeze(Object.fromEntries(Object.entries(STATUS_LABELS).map(([key, value]) => [value, key])));
  const NEXT_STATUSES = Object.freeze({
    order_received: ['awaiting_payment', 'rejected', 'cancelled', 'blocked'],
    awaiting_payment: ['payment_received', 'rejected', 'cancelled', 'blocked'],
    payment_received: ['payment_validation', 'rejected', 'cancelled', 'blocked', 'refund_pending'],
    payment_validation: ['approved_for_production', 'rejected', 'cancelled', 'blocked', 'refund_pending'],
    approved_for_production: ['in_production', 'cancelled', 'blocked', 'refund_pending'],
    in_production: ['ready', 'production_suspended', 'cancelled', 'refund_pending'],
    production_suspended: ['in_production', 'cancelled', 'refund_pending'],
    ready: ['shipped', 'available_for_pickup', 'delivery_issue', 'cancelled', 'refund_pending'],
    shipped: ['delivered', 'delivery_issue', 'refund_pending'],
    available_for_pickup: ['delivered', 'delivery_issue', 'refund_pending'],
    delivery_issue: ['shipped', 'available_for_pickup', 'delivered', 'refund_pending'],
    blocked: ['awaiting_payment', 'payment_validation', 'approved_for_production', 'cancelled', 'refund_pending'],
    refund_pending: ['refunded', 'blocked'],
    delivered: [],
    rejected: [],
    cancelled: [],
    refunded: []
  });
  const INTENT_PREFIX = 'triaxis_order_intent_v1:';
  const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
  const pendingPayloads = new Map();

  function requireClient() {
    if (!window.TriAxisAuth?.getClient) throw new Error('ORDERS_AUTH_NOT_INITIALIZED');
    return window.TriAxisAuth.getClient();
  }

  function requireSession() {
    if (!window.TriAxisAuth?.getState?.()?.session?.user?.id) throw new Error('ORDERS_AUTH_REQUIRED');
  }

  function cleanObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
  }

  function intentStorageKey(intentId) {
    const userId = window.TriAxisAuth?.getState?.()?.session?.user?.id;
    if (!userId || !intentId) throw new Error('ORDER_INTENT_MISSING');
    return `${INTENT_PREFIX}${userId}:${String(intentId).slice(0, 160)}`;
  }

  async function intentFingerprint(payload) {
    const canonical = JSON.stringify(stableValue({
      productId: payload.productId,
      quantity: Number(payload.quantity),
      configuration: cleanObject(payload.configuration),
      notes: String(payload.notes || '')
    }));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function readIntent(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (error) { return null; }
  }

  function purgeExpiredIntents() {
    const now = Date.now();
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(INTENT_PREFIX)) continue;
      const intent = readIntent(key);
      if (!intent?.createdAt || now - Date.parse(intent.createdAt) > INTENT_TTL_MS) {
        sessionStorage.removeItem(key);
        pendingPayloads.delete(key);
      }
    }
  }

  async function findSubmittedOrder(idempotencyKey) {
    const { data, error } = await requireClient().from('orders')
      .select('id, order_code')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function prepareIntent(intentId, payload) {
    purgeExpiredIntents();
    const key = intentStorageKey(intentId);
    const fingerprint = await intentFingerprint(payload);
    const existing = readIntent(key);
    if (existing?.resolvedOrder?.id) {
      sessionStorage.removeItem(key);
      pendingPayloads.delete(key);
      return { storageKey: key, idempotencyKey: existing.idempotencyKey, fingerprint: existing.fingerprint, resolvedOrder: existing.resolvedOrder };
    }
    if (existing?.idempotencyKey && existing.fingerprint === fingerprint) {
      return { storageKey: key, idempotencyKey: existing.idempotencyKey, fingerprint, resolvedOrder: null };
    }
    if (existing?.idempotencyKey && existing.sent) {
      const submitted = await findSubmittedOrder(existing.idempotencyKey);
      if (submitted) {
        sessionStorage.removeItem(key);
        pendingPayloads.delete(key);
        return { storageKey: key, idempotencyKey: existing.idempotencyKey, fingerprint: existing.fingerprint, resolvedOrder: submitted };
      }
      if (Date.now() - Date.parse(existing.lastAttemptAt || existing.createdAt) < 30000) {
        throw new Error('ORDER_RECONCILIATION_PENDING');
      }
    }
    const idempotencyKey = crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ idempotencyKey, fingerprint, version: crypto.randomUUID(), sent: false, createdAt: new Date().toISOString() }));
    return { storageKey: key, idempotencyKey, fingerprint, resolvedOrder: null };
  }

  async function cancelIntent(intentId) {
    let key;
    try { key = intentStorageKey(intentId); } catch (error) { return; }
    const existing = readIntent(key);
    if (!existing?.sent) {
      sessionStorage.removeItem(key);
      pendingPayloads.delete(key);
      return;
    }
    const submitted = await findSubmittedOrder(existing.idempotencyKey);
    const current = readIntent(key);
    if (!current || current.idempotencyKey !== existing.idempotencyKey || current.version !== existing.version || current.fingerprint !== existing.fingerprint || current.sent !== true) return;
    if (submitted) {
      sessionStorage.setItem(key, JSON.stringify({ ...current, resolvedOrder: submitted }));
    } else if (Date.now() - Date.parse(existing.lastAttemptAt || existing.createdAt) >= 30000) {
      sessionStorage.removeItem(key);
      pendingPayloads.delete(key);
    }
  }

  function clearAllIntents() {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(INTENT_PREFIX)) {
        sessionStorage.removeItem(key);
        pendingPayloads.delete(key);
      }
    }
  }

  function mapOrder(row, profile) {
    const item = Array.isArray(row.order_items) ? row.order_items[0] : null;
    const snapshot = cleanObject(item?.product_snapshot);
    const configuration = cleanObject(item?.configuration);
    profile = profile || {};
    return {
      id: row.id,
      orderCode: row.order_code,
      remote: true,
      remoteStatus: row.operational_status || 'order_received',
      status: STATUS_LABELS[row.operational_status] || row.operational_status || STATUS_LABELS.order_received,
      tag: profile.tag || '#-----',
      name: profile.display_name || 'Cliente TriAxis',
      phone: profile.phone || '—',
      qrId: row.order_code,
      requestedAt: row.submitted_at || row.created_at,
      notes: row.customer_notes || '',
      productId: String(snapshot.slug || '').replace(/-/g, '_'),
      remoteProductId: item?.product_id || snapshot.id || null,
      productName: snapshot.name || 'Artefato TriAxis',
      productVariant: configuration.variant || 'standard',
      productVariantLabel: configuration.variant || 'Standard',
      material: configuration.material || '',
      materialLabel: configuration.material || 'Sob consulta',
      finish: configuration.finish || '',
      finishLabel: configuration.finish || 'Sob consulta',
      accessory: configuration.accessory || '',
      accessoryLabel: configuration.accessory || 'Sob consulta',
      colorMain: configuration.color_main || '',
      colorAccent: configuration.color_accent || '',
      origin: configuration.origin || 'Catálogo online',
      deadline: configuration.deadline || '',
      quantity: Number(item?.quantity || 1),
      estimatedPrice: Number(row.total || item?.line_total || 0),
      discount: Number(row.discount || 0),
      shippingFee: Number(row.shipping_fee || 0),
      paymentMethod: row.payment_method || '',
      paymentReference: row.payment_reference || '',
      paymentPayer: row.payment_payer || '',
      paymentValidatedAt: row.payment_validated_at || null,
      approvedAt: row.approved_at || null,
      capacityConfirmedAt: row.capacity_confirmed_at || null,
      productionDueAt: row.production_due_at || null,
      deliveryMethod: row.delivery_method || '',
      deliveryDetails: cleanObject(row.delivery_details),
      trackingCode: row.tracking_code || '',
      history: Array.isArray(row.order_operational_history)
        ? [...row.order_operational_history].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        : []
    };
  }

  async function load() {
    requireSession();
    const { data, error } = await requireClient()
      .from('orders')
      .select('id, order_code, customer_id, status, operational_status, subtotal, discount, shipping_fee, total, customer_notes, submitted_at, created_at, payment_method, payment_reference, payment_payer, payment_validated_at, approved_at, capacity_confirmed_at, production_due_at, delivery_method, delivery_details, tracking_code, order_items(id, product_id, product_snapshot, quantity, configuration, unit_price, line_total), order_operational_history(id, from_status, to_status, changed_by, reason, metadata, created_at)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = data || [];
    const ownProfile = window.TriAxisAuth.getState()?.profile || {};
    const profiles = new Map([[ownProfile.id, ownProfile]]);
    const customerIds = Array.from(new Set(rows.map((row) => row.customer_id).filter((id) => id && !profiles.has(id))));
    if (customerIds.length) {
      const { data: profileRows, error: profileError } = await requireClient()
        .from('profiles')
        .select('id, display_name, phone, tag')
        .in('id', customerIds);
      if (profileError) throw profileError;
      (profileRows || []).forEach((profile) => profiles.set(profile.id, profile));
    }
    return rows.map((row) => mapOrder(row, profiles.get(row.customer_id)));
  }

  async function submit({ productId, quantity, configuration, notes, intentId }) {
    requireSession();
    if (!productId || !intentId) throw new Error('ORDER_INPUT_MISSING');
    const payload = { productId, quantity, configuration: cleanObject(configuration), notes: String(notes || '') };
    const prepared = await prepareIntent(intentId, payload);
    if (prepared.resolvedOrder) return prepared.resolvedOrder;
    const idempotencyKey = prepared.idempotencyKey;
    const attemptVersion = crypto.randomUUID();
    sessionStorage.setItem(prepared.storageKey, JSON.stringify({
      idempotencyKey,
      fingerprint: prepared.fingerprint,
      version: attemptVersion,
      sent: true,
      lastAttemptAt: new Date().toISOString(),
      createdAt: readIntent(prepared.storageKey)?.createdAt || new Date().toISOString()
    }));
    pendingPayloads.set(prepared.storageKey, payload);
    const { data, error } = await requireClient().rpc('submit_order', {
      requested_product_id: productId,
      requested_quantity: quantity,
      requested_configuration: payload.configuration,
      requested_notes: payload.notes,
      requested_idempotency_key: idempotencyKey
    });
    if (error) throw error;
    sessionStorage.removeItem(prepared.storageKey);
    pendingPayloads.delete(prepared.storageKey);
    return Array.isArray(data) ? data[0] : data;
  }

  async function setStatus(orderId, status, reason, transitionData = {}) {
    requireSession();
    if (!NEXT_STATUSES[status]) throw new Error('ORDER_STATUS_INVALID');
    if (String(reason || '').trim().length < 3) throw new Error('ORDER_STATUS_REASON_REQUIRED');
    const { error } = await requireClient().rpc('transition_order_v1', {
      target_order_id: orderId,
      target_status: status,
      status_reason: String(reason).trim().slice(0, 1000),
      transition_data: cleanObject(transitionData)
    });
    if (error) throw error;
  }

  async function revise(orderId, configuration, reason) {
    requireSession();
    if (!orderId || String(reason || '').trim().length < 3) throw new Error('ORDER_REVISION_INPUT_REQUIRED');
    const { error } = await requireClient().rpc('revise_order_configuration_v1', {
      target_order_id: orderId,
      revised_configuration: cleanObject(configuration),
      revision_reason: String(reason).trim().slice(0, 1000)
    });
    if (error) throw error;
  }

  function canTransitionTo(status) {
    const roles = window.TriAxisAuth?.getState?.()?.roles || [];
    if (roles.includes('admin')) return true;
    const allowedRoles = {
      awaiting_payment: ['commercial', 'finance'],
      rejected: ['commercial', 'finance'],
      payment_received: ['finance'],
      payment_validation: ['finance'],
      refund_pending: ['finance'],
      refunded: ['finance'],
      approved_for_production: ['operations'],
      in_production: ['production'],
      ready: ['production'],
      production_suspended: ['production'],
      shipped: ['logistics'],
      available_for_pickup: ['logistics'],
      delivery_issue: ['logistics'],
      delivered: ['logistics', 'support'],
      cancelled: ['commercial', 'operations', 'support'],
      blocked: ['finance', 'operations']
    }[status] || [];
    return allowedRoles.some((role) => roles.includes(role));
  }

  function allowedStatusOptions(currentStatus) {
    const statuses = [currentStatus, ...(NEXT_STATUSES[currentStatus] || []).filter(canTransitionTo)];
    return statuses.map((status) => ({ value: STATUS_LABELS[status] || status, remote: status }));
  }

  window.TriAxisOrders = Object.freeze({
    load,
    submit,
    setStatus,
    revise,
    prepareIntent,
    cancelIntent,
    clearAllIntents,
    purgeExpiredIntents,
    labelForStatus: (status) => STATUS_LABELS[status] || status,
    statusFromLabel: (label) => LABEL_STATUSES[label] || null,
    allowedStatusOptions
  });
})();
