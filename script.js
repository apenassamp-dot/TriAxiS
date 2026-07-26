/* ═══════════════════════════════════════════════════════════════════════
   TRIAXIS NEXUS — V4
   Gerador de tags + mini banco local + perfis completos + ID frente/verso.
═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const STORAGE_KEY = 'triaxis_agents_db';
  const SETTINGS_KEY = 'triaxis_settings';
  const LOG_KEY = 'triaxis_system_log';
  const PHYSICAL_REQUESTS_KEY = 'triaxis_physical_id_requests';
  const SIDEBAR_STATE_KEY = 'triaxis_sidebar_hidden';
  const PURCHASE_TAG_KEY = 'triaxis_validated_purchase_tag';
  const LOGIN_SESSION_KEY = 'triaxis_login_session';
  const PASSWORD_HASH_KEY = 'triaxis_agent_password_hashes';
  const LOGIN_ATTEMPT_KEY = 'triaxis_login_attempts';
  const LEGACY_AGENTS_KEY = 'triaxis_legacy_agents_v1';
  const LEGACY_REQUESTS_KEY = 'triaxis_legacy_physical_requests_v1';
  const LOGIN_MAX_ATTEMPTS = 3;
  const LOGIN_LOCK_MS = 60 * 1000;
  const MAX_PHOTO_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_STORED_PHOTO_BYTES = 1500 * 1024;
  const TAG_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  let agents = [];
  let currentTag = null;
  let tempPhotoBase64 = null;
  let scrambleTimer = null;
  let currentIdTag = null;
  let physicalRequests = [];
  let currentPhysicalTag = null;
  let currentPhysicalSide = 'front';
  let currentPhysicalProduct = 'vector_sigil';
  let currentPhysicalVariant = 'standard';
  let validatedPurchaseTag = null;
  let loggedAgentTag = null;
  let remoteAuthState = { session: null, profile: null, roles: [] };
  let passwordRecoveryMode = false;
  let passwordRecoveryLinkError = false;
  let passwordRecoveryUrlProcessing = false;
  let passwordResetRequestPending = false;
  let passwordResetCooldownUntil = 0;
  let passwordUpdatePending = false;
  let orderSubmissionPending = false;
  let orderRefreshSequence = 0;
  let previousRemoteUserId = null;
  let physicalOrderIntentId = null;
  let catalogOrderIntentId = null;
  let catalogSignedRefreshTimer = null;

  const DEFAULT_SETTINGS = { scanlines: true, glitch: true, noise: true, theme: 'classic', mode: 'client' };

  const PHYSICAL_ORDER_OPTIONS = {
    material: {
      pla_fosco: { label: 'PLA preto fosco', price: 19.90 },
      pla_vermelho: { label: 'PLA preto + detalhe vermelho', price: 24.90 },
      resina: { label: 'Resina premium', price: 34.90 },
      prototipo: { label: 'Versão protótipo', price: 16.90 }
    },
    finish: {
      simples: { label: 'Fosco simples', price: 0 },
      premium: { label: 'Premium com pintura', price: 12.00 },
      scratch: { label: 'Desgaste / scratch', price: 10.00 },
      verniz: { label: 'Verniz semi-brilho', price: 8.00 }
    },
    accessory: {
      ball_chain: { label: 'Corrente ball chain', price: 3.00 },
      argola: { label: 'Argola simples', price: 1.50 },
      mosquetao: { label: 'Mosquetão', price: 5.00 },
      sem_corrente: { label: 'Sem corrente', price: 0 }
    }
  };

  const CATALOG_PRODUCTS = [
    {
      id: 'vector_sigil',
      name: 'Vector Sigil',
      line: 'ACCESS TAG',
      img: 'assets/vector-sigil-front-hero.png',
      basePrice: 19.90,
      productionTime: '1–2 dias',
      description: 'Chaveiro ID físico com QR, serial e estética de acesso restrito TriAxis.',
      specs: ['QR dinâmico', 'Tag física', 'Frente / verso / lateral']
    },
    {
      id: 'omega_pass',
      name: 'Omega Pass',
      line: 'PREMIUM ACCESS',
      img: 'assets/omega-pass.png',
      basePrice: 34.90,
      productionTime: '2–3 dias',
      description: 'Passe premium com visual de credencial secreta e acabamento de coleção.',
      specs: ['Peça premium', 'Visual laboratório', 'Serial físico']
    },
    {
      id: 'mini_logo_tag',
      name: 'Mini Logo Tag',
      line: 'BRAND KEYCHAIN',
      img: 'assets/mini-logo-tag.jpg',
      basePrice: 14.90,
      productionTime: '1 dia',
      description: 'Tag compacta com a mini logo TriAxis para chaveiro, brinde ou embalagem.',
      specs: ['Leve', 'Marca forte', 'Boa para venda rápida']
    },
    {
      id: 'mascot_badge',
      name: 'Mascot Badge',
      line: 'CHARACTER UNIT',
      img: 'assets/mascot-badge.png',
      basePrice: 24.90,
      productionTime: '2 dias',
      description: 'Badge colecionável com o mascote TriAxis em estética cyberpunk 90s.',
      specs: ['Mascote', 'Colecionável', 'Detalhes vermelhos']
    },
    {
      id: 'agent_card',
      name: 'Agent ID Card',
      line: 'DIGITAL CREDENTIAL',
      img: 'assets/agent-card-product.png',
      basePrice: 29.90,
      productionTime: '2 dias',
      description: 'Credencial física inspirada em cartões de acesso internos e tags de agente.',
      specs: ['ID de agente', 'QR no verso', 'Visual técnico']
    },
    {
      id: 'cybershape_unit',
      name: 'CyberShape Unit',
      line: 'CUSTOM PRODUCT',
      img: 'assets/cybershape-unit.png',
      basePrice: 39.90,
      productionTime: 'sob consulta',
      description: 'Unidade customizada para peças físicas, miniaturas e protótipos TriAxis.',
      specs: ['Custom', 'Produção sob demanda', 'Acabamento manual']
    }
  ];

  const PHYSICAL_VARIANTS = {
    standard: { label: 'Standard', price: 0, desc: 'Versão padrão, equilibrada e pronta para produção.' },
    blackout: { label: 'Blackout', price: 6, desc: 'Quase toda preta, com vermelho discreto e aparência secreta.' },
    lab_access: { label: 'Lab Access', price: 9, desc: 'Mais técnica, com códigos, nível de acesso e visual de laboratório.' },
    prototype: { label: 'Prototype', price: 4, desc: 'Aparência industrial, marcações de teste e visual de protótipo.' }
  };
  const PHYSICAL_STATUSES = ['Pedido recebido', 'Aguardando comprovação', 'Comprovação recebida', 'Em validação', 'Aprovado para produção', 'Em produção', 'Pronto', 'Enviado', 'Disponível para retirada', 'Entregue'];


  const CATALOG_META = {
    vector_sigil: {
      category: 'ids', categoryLabel: 'IDs e Tags', type: 'ID FÍSICO', availability: 'available', availabilityLabel: 'Disponível', customization: 'Nome + QR + Tag', size: '70 × 32 × 4 mm',
      materials: ['PLA preto fosco', 'Resina premium', 'Detalhe vermelho'], uses: ['Identificação de agente', 'chaveiro de acesso', 'brinde premium'], gallery: ['assets/vector-sigil-front-hero.png', 'assets/vector-sigil-back.png', 'assets/vector-sigil-vistas-panel.png']
    },
    omega_pass: {
      category: 'ids', categoryLabel: 'IDs e Tags', type: 'PREMIUM ACCESS', availability: 'limited', availabilityLabel: 'Edição limitada', customization: 'Serial + nome + acabamento premium', size: 'Formato passe / tag premium',
      materials: ['PLA técnico', 'Resina', 'Pintura manual'], uses: ['Passe premium', 'item colecionável', 'credencial secreta'], gallery: ['assets/omega-pass.png']
    },
    mini_logo_tag: {
      category: 'ids', categoryLabel: 'IDs e Tags', type: 'BRAND KEYCHAIN', availability: 'available', availabilityLabel: 'Disponível', customization: 'Cores + argola + embalagem', size: 'Compacto',
      materials: ['PLA', 'PLA preto fosco'], uses: ['Chaveiro', 'brinde', 'embalagem'], gallery: ['assets/mini-logo-tag.jpg']
    },
    mascot_badge: {
      category: 'collectibles', categoryLabel: 'Colecionáveis', type: 'CHARACTER UNIT', availability: 'custom_order', availabilityLabel: 'Sob encomenda', customization: 'Cor + base + acabamento', size: 'Sob medida',
      materials: ['PLA', 'Resina', 'Pintura manual'], uses: ['Badge colecionável', 'mascote', 'display'], gallery: ['assets/mascot-badge.png']
    },
    agent_card: {
      category: 'ids', categoryLabel: 'IDs e Tags', type: 'DIGITAL CREDENTIAL', availability: 'custom_order', availabilityLabel: 'Sob encomenda', customization: 'Dados do agente + QR + verso', size: 'Cartão/placa',
      materials: ['PLA fino', 'Acrílico opcional', 'Adesivo técnico'], uses: ['Credencial', 'verificação', 'card de agente'], gallery: ['assets/agent-card-product.png']
    },
    cybershape_unit: {
      category: 'services', categoryLabel: 'Serviços', type: 'CUSTOM PRODUCT', availability: 'prototype', availabilityLabel: 'Protótipo', customization: 'Briefing completo', size: 'Sob consulta',
      materials: ['PLA', 'Resina', 'Epóxi opcional', 'Pintura manual'], uses: ['Protótipo', 'miniatura', 'peça customizada'], gallery: ['assets/cybershape-unit.png']
    }
  };

  const CATALOG_CATEGORIES = {
    all: 'Todos', ids: 'ACCESS TAGS', collectibles: 'CHARACTER UNITS', services: 'CUSTOM LAB'
  };


  /* ── Persistência ─────────────────────────────────────────────────── */
  function loadAgents() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_AGENTS_KEY);
      return [];
    } catch (e) {
      console.error('Falha ao carregar banco de agentes:', e);
      return [];
    }
  }

  function saveAgents() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      console.error('Falha ao salvar banco de agentes:', e);
      showToast('ERRO AO SALVAR NO NAVEGADOR', 'error');
      return false;
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function loadLog() {
    try {
      localStorage.removeItem(LOG_KEY);
      const raw = sessionStorage.getItem(LOG_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveLog(log) {
    sessionStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 80)));
  }

  function addLog(message) {
    const log = loadLog();
    log.unshift({ message, at: new Date().toISOString() });
    saveLog(log);
    renderSystemLog();
  }

  function normalizeAgent(agent) {
    const createdAt = agent.createdAt || new Date().toISOString();
    const normalized = {
      tag: agent.tag || '#-----',
      name: agent.name || 'Agente sem nome',
      phone: agent.phone || '—',
      photo: sanitizePhotoDataUrl(agent.photo),
      role: agent.role || 'Agente TriAxis',
      level: agent.level || 'LVL-02',
      status: agent.status || 'Autorizado',
      notes: agent.notes || 'REGISTRO INTERNO TRIAXIS',
      qrId: agent.qrId || null,
      qrPayload: agent.qrPayload || null,
      updatedAt: agent.updatedAt || createdAt,
      createdAt
    };
    return ensureAgentQrData(normalized);
  }

  function loadPhysicalIdRequests() {
    try {
      localStorage.removeItem(PHYSICAL_REQUESTS_KEY);
      localStorage.removeItem(LEGACY_REQUESTS_KEY);
      return [];
    } catch (e) {
      console.error('Falha ao carregar solicitações físicas:', e);
      return [];
    }
  }

  function savePhysicalIdRequests() {
    try {
      localStorage.removeItem(PHYSICAL_REQUESTS_KEY);
      return true;
    } catch (e) {
      console.error('Falha ao salvar solicitações físicas:', e);
      showToast('ERRO AO SALVAR SOLICITAÇÃO FÍSICA', 'error');
      return false;
    }
  }

  function normalizePhysicalRequest(request) {
    return {
      id: request.id || `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      remote: request.remote === true,
      remoteStatus: request.remoteStatus || '',
      remoteProductId: request.remoteProductId || null,
      tag: request.tag || '#-----',
      name: request.name || 'Agente sem nome',
      phone: request.phone || '—',
      qrId: request.qrId || '—',
      requestedAt: request.requestedAt || new Date().toISOString(),
      status: request.status || 'Pendente',
      notes: request.notes || '',
      material: request.material || 'pla_fosco',
      materialLabel: request.materialLabel || getPhysicalOptionLabel('material', request.material || 'pla_fosco'),
      finish: request.finish || 'simples',
      finishLabel: request.finishLabel || getPhysicalOptionLabel('finish', request.finish || 'simples'),
      accessory: request.accessory || 'ball_chain',
      accessoryLabel: request.accessoryLabel || getPhysicalOptionLabel('accessory', request.accessory || 'ball_chain'),
      productId: request.productId || 'vector_sigil',
      productName: request.productName || getCatalogProduct(request.productId || 'vector_sigil').name,
      productVariant: request.productVariant || 'standard',
      productVariantLabel: request.productVariantLabel || getVariantLabel(request.productVariant || 'standard'),
      orderCode: request.orderCode || '',
      quantity: getOrderQuantity(request),
      colorMain: request.colorMain || '',
      colorAccent: request.colorAccent || '',
      category: request.category || '',
      origin: request.origin || '',
      deadline: request.deadline || request.estimatedDays || '',
      estimatedDays: request.estimatedDays || request.deadline || '',
      estimatedPrice: Number.isFinite(Number(request.estimatedPrice)) ? Number(request.estimatedPrice) : estimatePhysicalPrice(request.material || 'pla_fosco', request.finish || 'simples', request.accessory || 'ball_chain', request.productId || 'vector_sigil', request.productVariant || 'standard')
    };
  }

  function sanitizePhotoDataUrl(value) {
    if (typeof value !== 'string' || value.length > MAX_STORED_PHOTO_BYTES * 1.4) return null;
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value) ? value : null;
  }

  function migrateAgentQrData(list) {
    const seen = new Set();
    return list.map((agent) => {
      let migrated = ensureAgentQrData(agent);
      while (seen.has(migrated.qrId)) {
        migrated = { ...migrated, qrId: generateQrId({ ...migrated, qrId: null }) };
        migrated.qrPayload = generateQrPayload(migrated);
      }
      seen.add(migrated.qrId);
      return migrated;
    });
  }

  function generateQrId(agent) {
    const cleanTag = String(agent.tag || 'XXXXX').replace('#', '').toUpperCase();
    const date = new Date(agent.createdAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
    const seed = `${agent.tag}|${agent.name}|${agent.phone}|${agent.role}|${agent.level}|${agent.status}|${agent.createdAt}|${Math.random()}`;
    const suffix = Math.abs(hashString(seed)).toString(36).toUpperCase().slice(0, 4).padStart(4, '0');
    return `TRX-QR-${cleanTag}-${date}-${suffix}`;
  }

  function generateQrPayload(agent) {
    return `TRIAXIS://AGENT/${encodeURIComponent(agent.tag)}/${encodeURIComponent(agent.qrId || generateQrId(agent))}`;
  }

  function ensureAgentQrData(agent) {
    if (!agent.qrId) agent.qrId = generateQrId(agent);
    if (!agent.qrPayload) agent.qrPayload = generateQrPayload(agent);
    return agent;
  }

  /* ── Tags ─────────────────────────────────────────────────────────── */
  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function generateRandomTag() {
    const pool = shuffleArray(TAG_CHARS.split(''));
    return '#' + pool.slice(0, 5).join('');
  }

  function generateUniqueTag() {
    const existing = new Set(agents.map((a) => a.tag));
    let tag;
    let attempts = 0;
    do {
      tag = generateRandomTag();
      attempts++;
    } while (existing.has(tag) && attempts < 700);
    return tag;
  }

  function normalizeTagInput(raw) {
    if (!raw) return '';
    let t = raw.trim().toUpperCase().replace(/\s+/g, '');
    if (!t.startsWith('#')) t = '#' + t;
    return t;
  }

  function scrambleTagReveal(targetTag) {
    const el = document.getElementById('tagText');
    const settings = loadSettings();
    clearInterval(scrambleTimer);
    if (!settings.glitch) {
      el.textContent = targetTag;
      return;
    }
    const targetChars = targetTag.replace('#', '').split('');
    const lockAt = targetChars.map((_, i) => 6 + i * 3);
    const totalFrames = lockAt[lockAt.length - 1] + 4;
    let frame = 0;
    scrambleTimer = setInterval(() => {
      let display = '#';
      for (let i = 0; i < targetChars.length; i++) {
        display += frame >= lockAt[i] ? targetChars[i] : TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)];
      }
      el.textContent = display;
      frame++;
      if (frame > totalFrames) {
        el.textContent = targetTag;
        clearInterval(scrambleTimer);
      }
    }, 38);
  }

  function setCurrentTag(tag) {
    currentTag = tag;
    scrambleTagReveal(tag);
    setText('formTagValue', tag);
  }

  /* ── Navegação / modais ───────────────────────────────────────────── */
  function switchView(viewName) {
    const adminOnly = ['bank', 'settings'].includes(viewName);
    const productionOnly = viewName === 'production';
    if ((adminOnly && (!hasRemoteRole('admin') || isClientSimulationMode())) ||
      (productionOnly && (!canAccessProduction() || (hasRemoteRole('admin') && isClientSimulationMode())))) {
      showToast('ACESSO NAO AUTORIZADO PARA ESTA FUNCAO', 'error');
      viewName = 'home';
    }
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    const view = document.getElementById('view-' + viewName);
    const nav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (view) view.classList.add('active');
    if (nav) nav.classList.add('active');
    if (viewName === 'bank') renderBank();
    if (viewName === 'physical') renderPhysicalIdView();
    if (viewName === 'catalog') renderCatalog();
    if (viewName === 'production') renderProduction();
    if (viewName === 'profile') renderUserProfile();
    if (viewName === 'quote') renderQuoteEstimate();
    if (viewName === 'lab') renderLabGallery();
    if (viewName === 'settings') renderSettings();
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (id === 'modalPhysicalId' && physicalOrderIntentId) {
      void window.TriAxisOrders?.cancelIntent?.(physicalOrderIntentId)?.catch((error) => console.error('Falha ao reconciliar intenção física:', error));
      physicalOrderIntentId = null;
    }
    if (id === 'modalCatalogConfig' && catalogOrderIntentId) {
      void window.TriAxisOrders?.cancelIntent?.(catalogOrderIntentId)?.catch((error) => console.error('Falha ao reconciliar intenção de catálogo:', error));
      catalogOrderIntentId = null;
    }
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.open').forEach((m) => {
      m.classList.remove('open');
      m.setAttribute('aria-hidden', 'true');
    });
  }

  /* ── Cadastro ─────────────────────────────────────────────────────── */
  function openAddProfileModal() {
    closeAllModals();
    switchView('profile');
    openLoginPanel();
    setLoginMode('create');
    showToast('INFORME SEU E-MAIL PARA CRIAR A CONTA');
  }

  function resetPhotoPreview() {
    const preview = document.getElementById('photoPreview');
    preview.style.backgroundImage = '';
    preview.innerHTML = '<span class="photo-preview-placeholder">SEM FOTO</span>';
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('ARQUIVO INVÁLIDO — ENVIE UMA IMAGEM', 'error');
      return;
    }
    if (file.size > MAX_PHOTO_FILE_BYTES) {
      showToast('IMAGEM MUITO GRANDE - LIMITE DE 8 MB', 'error');
      e.target.value = '';
      return;
    }
    try {
      const compressed = await readCatalogImageFile(file, 900, 0.8);
      if (new Blob([compressed]).size > MAX_STORED_PHOTO_BYTES) throw new Error('Imagem compactada excede o limite');
      tempPhotoBase64 = sanitizePhotoDataUrl(compressed);
      if (!tempPhotoBase64) throw new Error('Formato de imagem nao permitido');
      const preview = document.getElementById('photoPreview');
      preview.style.backgroundImage = `url(${tempPhotoBase64})`;
      preview.innerHTML = '';
    } catch (error) {
      tempPhotoBase64 = null;
      resetPhotoPreview();
      showToast('ERRO AO PROCESSAR IMAGEM - USE JPG, PNG OU WEBP', 'error');
      e.target.value = '';
    }
  }

  function maskPhone(value) {
    let digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length > 10) return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
    if (digits.length > 6) return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
    if (digits.length > 2) return digits.replace(/(\d{2})(\d{0,5})/, '($1) $2').trim();
    if (digits.length > 0) return digits.replace(/(\d{0,2})/, '($1');
    return '';
  }

  async function handleAddProfileSubmit(e) {
    e.preventDefault();
    if (!requireAdminMode()) return;
    const errorEl = document.getElementById('formError');
    if (errorEl) errorEl.textContent = 'CADASTRO LOCAL DESATIVADO. NOVAS CONTAS DEVEM USAR “CRIAR ID” COM E-MAIL.';
    showToast('USE O CADASTRO ONLINE EM MEU PERFIL', 'error');
  }

  /* ── Busca ────────────────────────────────────────────────────────── */
  function findAgentByTag(tag) {
    const logged = getLoggedAgent();
    if (logged?.tag === tag) return logged;
    return agents.find((a) => a.tag === tag) || null;
  }

  function findAgents(query, status = 'all', level = 'all') {
    const q = (query || '').trim().toUpperCase();
    return agents.filter((a) => {
      const hay = `${a.tag} ${a.name} ${a.phone} ${a.role}`.toUpperCase();
      const textOk = !q || hay.includes(q) || hay.includes(normalizeTagInput(q));
      const statusOk = status === 'all' || a.status === status;
      const levelOk = level === 'all' || a.level === level;
      return textOk && statusOk && levelOk;
    });
  }

  function performTagSearch(inputEl, resultEl) {
    const raw = inputEl.value;
    const tag = normalizeTagInput(raw);
    if (tag === '#' || tag === '') { resultEl.innerHTML = ''; return; }
    runScanAnimation(Boolean(findAgentByTag(tag)));
    renderSearchResult(resultEl, findAgentByTag(tag), tag);
  }

  function performAdvancedSearch() {
    const resultEl = document.getElementById('searchResultMain');
    const query = document.getElementById('searchInputMain').value;
    const status = document.getElementById('searchStatusFilter').value;
    const level = document.getElementById('searchLevelFilter').value;
    if (!query.trim() && status === 'all' && level === 'all') { resultEl.innerHTML = ''; return; }
    const matches = findAgents(query, status, level);
    runScanAnimation(matches.length > 0);
    renderSearchList(resultEl, matches, query || 'filtros selecionados');
  }

  function performSidebarSearch() {
    const input = document.getElementById('sidebarSearchInput');
    const status = document.getElementById('sidebarSearchStatus');
    const q = input.value.trim();
    if (!q) { status.textContent = 'NODE READY'; status.className = 'sidebar-search-status'; return; }
    const matches = q.startsWith('#') || /^[a-z0-9]{5}$/i.test(q) ? [findAgentByTag(normalizeTagInput(q))].filter(Boolean) : findAgents(q);
    if (matches.length) {
      status.textContent = `AGENT FOUND · ${matches[0].tag}`;
      status.className = 'sidebar-search-status found';
      switchView('search');
      document.getElementById('searchInputMain').value = q;
      renderSearchList(document.getElementById('searchResultMain'), matches, q);
      openIdCard(matches[0].tag);
    } else {
      status.textContent = 'ACCESS DENIED · NOT FOUND';
      status.className = 'sidebar-search-status denied';
    }
  }

  function runScanAnimation(found) {
    const el = document.getElementById('scanStatus');
    if (!el) return;
    const steps = ['SCANNING TAG...', 'VERIFYING DATABASE...', found ? 'AGENT FOUND · ACCESS GRANTED' : 'NO MATCH FOUND · ACCESS DENIED'];
    el.classList.add('active');
    let i = 0;
    el.textContent = steps[i];
    const timer = setInterval(() => {
      i++;
      el.textContent = steps[i] || steps[steps.length - 1];
      if (i >= steps.length - 1) {
        clearInterval(timer);
        setTimeout(() => el.classList.remove('active'), 900);
      }
    }, 420);
  }

  function renderSearchResult(container, agent, searchedTag) {
    if (!agent) {
      container.innerHTML = `<div class="result-denied"><div class="result-denied-title">ACESSO NEGADO</div><p class="result-denied-sub">Nenhum agente encontrado para a tag <strong>${escapeHtml(searchedTag)}</strong>. Verifique o código e tente novamente.</p></div>`;
      return;
    }
    renderSearchList(container, [agent], searchedTag);
  }

  function renderSearchList(container, matches, searched) {
    if (!matches.length) {
      container.innerHTML = `<div class="result-denied"><div class="result-denied-title">ACESSO NEGADO</div><p class="result-denied-sub">Nenhum agente encontrado para <strong>${escapeHtml(searched)}</strong>.</p></div>`;
      return;
    }
    container.innerHTML = matches.map(renderAgentResultCard).join('');
    container.querySelectorAll('.result-photo').forEach((el, index) => {
      const photo = sanitizePhotoDataUrl(matches[index]?.photo);
      if (photo) el.style.backgroundImage = `url("${photo}")`;
    });
    container.querySelectorAll('[data-open-id]').forEach((el) => {
      el.addEventListener('click', () => openIdCard(el.getAttribute('data-open-id')));
    });
    container.querySelectorAll('[data-request-physical]').forEach((el) => {
      el.addEventListener('click', () => openPhysicalIdModal(el.getAttribute('data-request-physical')));
    });
    updatePurchaseGateUi();
  }

  function renderAgentResultCard(agent) {
    const initials = agent.photo ? '' : getInitialsAvatar(agent.name);
    return `
      <div class="result-card">
        <div class="result-photo">${initials}</div>
        <div class="result-info">
          <div class="result-name">${escapeHtml(agent.name)}</div>
          <div class="result-tag" data-open-id="${escapeHtml(agent.tag)}">${escapeHtml(agent.tag)}</div>
          <div class="result-phone">${escapeHtml(agent.phone)}</div>
          <div class="result-extra">
            <span class="badge badge-red">${escapeHtml(agent.level)}</span>
            <span class="badge ${getStatusBadgeClass(agent.status)}">${escapeHtml(agent.status)}</span>
            <span class="badge">${escapeHtml(agent.role)}</span>
          </div>
        </div>
        <div class="result-actions">
          <button class="btn btn-outline btn-sm" data-request-physical="${escapeHtml(agent.tag)}" type="button">SOLICITAR ID FÍSICO</button>
          <button class="btn btn-primary btn-sm" data-open-id="${escapeHtml(agent.tag)}" type="button">ABRIR ID DIGITAL</button>
        </div>
      </div>
    `;
  }

  /* ── ID Digital ───────────────────────────────────────────────────── */
  function openIdCard(tag) {
    const agent = findAgentByTag(tag);
    if (!agent) { showToast('AGENTE NÃO ENCONTRADO', 'error'); return; }
    currentIdTag = tag;
    const card = document.getElementById('idCardCanvasSource');
    card.classList.remove('flipped');
    setText('idCardName', agent.name);
    setText('idCardTag', agent.tag);
    setText('idBackTag', agent.tag);
    setText('idBackName', agent.name);
    setText('idBackTagTopic', agent.tag);
    setText('idBackQrId', agent.qrId);
    setText('idBackPhone', agent.phone);
    setText('idBackRole', agent.role);
    setText('idBackLevel', agent.level);
    setText('idBackStatus', agent.status);
    setText('idBackUpdated', formatDate(agent.updatedAt));
    setText('idCardPhone', agent.phone);
    setText('idCardRole', agent.role);
    setText('idCardLevel', agent.level);
    setText('idCardDate', formatDate(agent.createdAt));
    setText('idInternalCode', buildInternalCode(agent));
    setText('idCardNotes', agent.notes || 'REGISTRO INTERNO TRIAXIS');
    const statusEl = document.getElementById('idCardStatus');
    statusEl.innerHTML = `<span class="id-status-dot"></span> ${escapeHtml(agent.status.toUpperCase())}`;
    statusEl.className = 'id-field-value id-status ' + getStatusClass(agent.status);

    const photoEl = document.getElementById('idCardPhoto');
    if (agent.photo) {
      photoEl.style.backgroundImage = `url(${agent.photo})`;
      photoEl.textContent = '';
    } else {
      photoEl.style.backgroundImage = '';
      photoEl.textContent = getInitialsAvatar(agent.name);
    }
    renderRealQrCode('idQrMatrix', agent.qrPayload || `${agent.tag}|${agent.name}|${agent.level}|${agent.status}`);
    addLog(`ID ABERTA · ${agent.tag}`);
    openModal('modalIdCard');
    updatePurchaseGateUi();
  }

  function flipIdCard() {
    document.getElementById('idCardCanvasSource').classList.toggle('flipped');
  }

  function renderQrMatrix(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const size = 15;
    const hash = hashString(text);
    let html = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inAnchor = (x < 4 && y < 4) || (x > 10 && y < 4) || (x < 4 && y > 10);
        const on = inAnchor || (((x * 17 + y * 31 + hash + (x ^ y) * 13) % 7) < 3);
        html += `<span class="qr-cell ${on ? 'on' : ''} ${inAnchor ? 'anchor' : ''}"></span>`;
      }
    }
    el.innerHTML = html;
  }


  function renderRealQrCode(containerId, payload) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    if (window.QRCode) {
      try {
        new QRCode(el, {
          text: payload,
          width: 132,
          height: 132,
          colorDark: '#FFFFFF',
          colorLight: '#090909',
          correctLevel: QRCode.CorrectLevel.M
        });
        el.classList.add('qr-real-ready');
        return;
      } catch (e) {
        console.warn('QR real indisponível, usando fallback visual:', e);
      }
    }
    el.classList.remove('qr-real-ready');
    renderQrMatrix(containerId, payload);
  }

  function downloadCurrentIdPng() {
    const agent = findAgentByTag(currentIdTag);
    if (!agent) return;
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 540;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const grd = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grd.addColorStop(0, '#111111'); grd.addColorStop(1, '#030303');
    ctx.fillStyle = grd; ctx.fillRect(26, 26, 848, 488);
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--c-red').trim() || '#E8001C';
    ctx.lineWidth = 4; ctx.strokeRect(26, 26, 848, 488);
    ctx.fillStyle = 'rgba(232,0,28,.09)'; ctx.fillRect(26, 26, 848, 76);

    ctx.fillStyle = '#ffffff'; ctx.font = '700 32px Orbitron, sans-serif'; ctx.fillText('TRIAXIS CYBERSHAPE', 52, 76);
    ctx.fillStyle = ctx.strokeStyle; ctx.font = '18px Share Tech Mono, monospace'; ctx.fillText('CREDENCIAL DIGITAL // AGENT REGISTRY', 52, 118);

    ctx.fillStyle = '#151515'; ctx.fillRect(54, 152, 190, 190); ctx.strokeRect(54, 152, 190, 190);
    drawAvatarOnCanvas(ctx, agent, 54, 152, 190, 190, () => {
      drawIdTextAndDownload(ctx, canvas, agent);
    });
  }

  function drawAvatarOnCanvas(ctx, agent, x, y, w, h, done) {
    if (agent.photo) {
      const img = new Image();
      img.onload = function () {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.drawImage(img, x, y, w, h); ctx.restore(); done();
      };
      img.onerror = done;
      img.src = agent.photo;
    } else {
      ctx.fillStyle = '#151515'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#E8001C'; ctx.font = '700 58px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(getInitialsAvatar(agent.name), x + w / 2, y + h / 2 + 20); ctx.textAlign = 'left'; done();
    }
  }

  function drawIdTextAndDownload(ctx, canvas, agent) {
    const red = getComputedStyle(document.body).getPropertyValue('--c-red').trim() || '#E8001C';
    ctx.fillStyle = '#888'; ctx.font = '16px Share Tech Mono, monospace';
    ctx.fillText('NOME', 284, 168); ctx.fillText('TAG', 284, 240); ctx.fillText('NÍVEL / STATUS', 284, 312); ctx.fillText('FUNÇÃO', 284, 384);
    ctx.fillStyle = '#fff'; ctx.font = '700 30px Oxanium, sans-serif'; ctx.fillText(agent.name.toUpperCase().slice(0, 24), 284, 202);
    ctx.fillStyle = red; ctx.font = '32px Share Tech Mono, monospace'; ctx.fillText(agent.tag, 284, 274);
    ctx.fillStyle = '#fff'; ctx.font = '22px Share Tech Mono, monospace'; ctx.fillText(`${agent.level} · ${agent.status}`.toUpperCase().slice(0, 28), 284, 346);
    ctx.fillText((agent.role || 'Agente TriAxis').toUpperCase().slice(0, 28), 284, 418);

    if (!drawQrCanvas(ctx, agent, 678, 160, 150)) {
      showToast('QR REAL INDISPONIVEL - EXPORTACAO CANCELADA', 'error');
      return;
    }
    ctx.fillStyle = red; ctx.font = '700 28px Orbitron, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Agente qualificado', 450, 486);
    ctx.fillStyle = '#fff'; ctx.font = '20px Share Tech Mono, monospace'; ctx.fillText('シンライ', 450, 512); ctx.textAlign = 'left';

    const a = document.createElement('a');
    a.download = `triaxis-id-${agent.tag.replace('#', '')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    addLog(`ID EXPORTADA EM PNG · ${agent.tag}`);
    showToast('ID DIGITAL EXPORTADA EM PNG');
  }

  function drawQrCanvas(ctx, agent, x0, y0, size) {
    if (!window.QRCode) return false;
    try {
      const holder = document.createElement('div');
      const qr = new QRCode(holder, {
        text: agent.qrPayload || generateQrPayload(agent),
        width: 512,
        height: 512,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      const source = holder.querySelector('canvas');
      if (!source) return false;
      const moduleCount = inferQrModuleCount(source);
      if (!moduleCount) return false;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0, y0, size, size);
      const quiet = size * 4 / (moduleCount + 8);
      ctx.drawImage(source, x0 + quiet, y0 + quiet, size - quiet * 2, size - quiet * 2);
      ctx.restore();
      return true;
    } catch (error) {
      console.error('Falha ao desenhar QR real no canvas:', error);
      return false;
    }
  }

  function inferQrModuleCount(canvas) {
    const sourceContext = canvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) return null;
    const pixels = sourceContext.getImageData(0, 0, canvas.width, canvas.height).data;
    const isDark = (row, col, count) => {
      const x = Math.min(canvas.width - 1, Math.floor((col + 0.5) * canvas.width / count));
      const y = Math.min(canvas.height - 1, Math.floor((row + 0.5) * canvas.height / count));
      const offset = (y * canvas.width + x) * 4;
      return pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 384;
    };
    const finderExpected = (row, col) => row === 0 || row === 6 || col === 0 || col === 6 || (row >= 2 && row <= 4 && col >= 2 && col <= 4);
    let best = null;
    for (let count = 21; count <= 177; count += 4) {
      let matches = 0;
      let checks = 0;
      [[0, 0], [0, count - 7], [count - 7, 0]].forEach(([rowOffset, colOffset]) => {
        for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) {
          matches += isDark(rowOffset + row, colOffset + col, count) === finderExpected(row, col) ? 1 : 0;
          checks++;
        }
      });
      for (let index = 8; index < count - 8; index++) {
        const expected = index % 2 === 0;
        matches += isDark(6, index, count) === expected ? 1 : 0;
        matches += isDark(index, 6, count) === expected ? 1 : 0;
        checks += 2;
      }
      const score = matches / checks;
      if (!best || score > best.score) best = { count, score };
    }
    return best?.score >= 0.98 ? best.count : null;
  }

  /* ── Banco ────────────────────────────────────────────────────────── */
  function renderBank() {
    const grid = document.getElementById('agentsGrid');
    const empty = document.getElementById('bankEmpty');
    const countLabel = document.getElementById('bankCount');
    const filterText = document.getElementById('bankFilterText')?.value || '';
    const filterStatus = document.getElementById('bankFilterStatus')?.value || 'all';
    const filterLevel = document.getElementById('bankFilterLevel')?.value || 'all';
    const visibleAgents = findAgents(filterText, filterStatus, filterLevel).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    countLabel.textContent = `${agents.length} agente${agents.length !== 1 ? 's' : ''} registrado${agents.length !== 1 ? 's' : ''} · ${visibleAgents.length} visível${visibleAgents.length !== 1 ? 's' : ''}`;
    if (visibleAgents.length === 0) { grid.innerHTML = ''; empty.classList.add('visible'); return; }
    empty.classList.remove('visible');
    grid.innerHTML = visibleAgents.map((agent) => {
      const initials = agent.photo ? '' : getInitialsAvatar(agent.name);
      return `
        <div class="agent-card agent-card--compact">
          <button class="agent-card-photo agent-card-photo--button" data-expand-agent="${escapeHtml(agent.tag)}" type="button" aria-label="Expandir ID de ${escapeHtml(agent.name)}">${initials}</button>
          <button class="btn btn-primary btn-block agent-expand-btn" data-expand-agent="${escapeHtml(agent.tag)}" type="button">EXPANDIR ID</button>
        </div>`;
    }).join('');
    grid.querySelectorAll('.agent-card-photo').forEach((el, index) => {
      const photo = sanitizePhotoDataUrl(visibleAgents[index]?.photo);
      if (photo) el.style.backgroundImage = `url("${photo}")`;
    });
    grid.querySelectorAll('[data-expand-agent]').forEach((btn) => btn.addEventListener('click', () => openBankAgentModal(btn.getAttribute('data-expand-agent'))));
  }

  function openBankAgentModal(tag) {
    const agent = findAgentByTag(tag);
    if (!agent) { showToast('AGENTE NÃO ENCONTRADO', 'error'); return; }
    currentIdTag = agent.tag;
    setText('bankModalName', agent.name);
    setText('bankModalTag', agent.tag);
    setText('bankModalPhone', agent.phone);
    setText('bankModalRole', agent.role);
    setText('bankModalLevel', agent.level);
    setText('bankModalStatus', agent.status);
    setText('bankModalQrId', agent.qrId || '—');
    setText('bankModalCreated', formatDate(agent.createdAt));
    setText('bankModalUpdated', formatDate(agent.updatedAt));
    setText('bankModalNotes', agent.notes || 'REGISTRO INTERNO TRIAXIS');
    setText('bankModalHistory', getAgentOrderHistoryText(agent.tag));
    const photoEl = document.getElementById('bankModalPhoto');
    if (photoEl) {
      if (agent.photo) {
        photoEl.style.backgroundImage = `url(${agent.photo})`;
        photoEl.textContent = '';
      } else {
        photoEl.style.backgroundImage = '';
        photoEl.textContent = getInitialsAvatar(agent.name);
      }
    }
    const statusEl = document.getElementById('bankModalStatusBadge');
    if (statusEl) {
      statusEl.className = `badge ${getStatusBadgeClass(agent.status)}`;
      statusEl.textContent = agent.status;
    }
    openModal('modalBankAgent');
    updatePurchaseGateUi();
  }

  function openIdFromBankModal() {
    const tag = currentIdTag;
    closeModal('modalBankAgent');
    openIdCard(tag);
  }

  function requestPhysicalFromBankModal() {
    const tag = currentIdTag;
    closeModal('modalBankAgent');
    openPhysicalIdModal(tag);
  }

  function removeAgentFromBankModal() {
    const tag = currentIdTag;
    closeModal('modalBankAgent');
    removeAgent(tag);
  }

  function removeAgent(tag) {
    if (!requireAdminMode()) return;
    const agent = findAgentByTag(tag);
    if (!agent) return;
    if (!confirm(`Remover permanentemente o agente ${agent.name} (${tag})?`)) return;
    const previousAgents = agents;
    agents = agents.filter((a) => a.tag !== tag);
    if (validatedPurchaseTag === tag) saveValidatedPurchaseTag(null);
    if (!saveAgents()) {
      agents = previousAgents;
      return;
    }
    addLog(`AGENTE ${tag} REMOVIDO`);
    renderAllDynamic();
    showToast(`AGENTE ${tag} REMOVIDO DO SISTEMA`);
  }

  /* ── ID físico / chaveiro ───────────────────────────────────────── */
  function renderPhysicalIdView() {
    const select = document.getElementById('physicalAgentSelect');
    if (!select) return;
    const previous = currentPhysicalTag || select.value;
    const productSelect = document.getElementById('physicalProductSelect');
    const variantSelect = document.getElementById('physicalVariantSelect');
    if (productSelect) {
      const availableProducts = getCatalogAdminRecords().filter(product => !product.hidden);
      productSelect.innerHTML = availableProducts.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join('');
      if (!availableProducts.some(product => product.id === currentPhysicalProduct)) currentPhysicalProduct = availableProducts[0]?.id || CATALOG_PRODUCTS[0]?.id || 'vector_sigil';
      productSelect.value = currentPhysicalProduct;
    }
    if (variantSelect) variantSelect.value = currentPhysicalVariant;
    const product = getCatalogProduct(currentPhysicalProduct);
    const techTitle = document.querySelector('.physical-tech-head h3');
    if (techTitle) techTitle.textContent = `${product.name.toUpperCase()} // TECH SPECS`;
    select.innerHTML = '<option value="">Selecione um agente</option>' + agents.map(agent => `<option value="${escapeHtml(agent.tag)}">${escapeHtml(agent.name)} · ${escapeHtml(agent.tag)}</option>`).join('');
    if (previous && findAgentByTag(previous)) select.value = previous;
    if (!currentPhysicalTag && agents[0]) currentPhysicalTag = agents[0].tag;
    if (currentPhysicalTag && findAgentByTag(currentPhysicalTag)) select.value = currentPhysicalTag;
    updatePhysicalProductSummary();
    renderPhysicalKeychainPreview(findAgentByTag(currentPhysicalTag), currentPhysicalSide);
    renderPhysicalRequests();
  }

  function selectPhysicalAgent(tag) {
    currentPhysicalTag = tag;
    const select = document.getElementById('physicalAgentSelect');
    if (select) select.value = tag || '';
    renderPhysicalKeychainPreview(findAgentByTag(tag), currentPhysicalSide);
    updatePhysicalProductSummary();
  }

  function searchPhysicalAgent() {
    const input = document.getElementById('physicalAgentSearch');
    const status = document.getElementById('physicalViewStatus');
    const q = input?.value || '';
    const matches = findAgents(q);
    if (matches.length) {
      selectPhysicalAgent(matches[0].tag);
      if (status) { status.textContent = `AGENT LOADED · ${matches[0].tag}`; status.className = 'sidebar-search-status found'; }
    } else if (status) {
      status.textContent = 'AGENT NOT FOUND'; status.className = 'sidebar-search-status denied';
    }
  }

  function renderPhysicalKeychainPreview(agent, side = 'front', targetId = 'physicalKeychainPreview') {
    const container = document.getElementById(targetId);
    if (!container) return;
    if (!agent) {
      container.innerHTML = '<div class="physical-empty">SELECIONE UM AGENTE<br><span>NODE AWAITING DATA</span></div>';
      return;
    }

    const cleanTag = escapeHtml(agent.tag || '#-----');
    const product = getCatalogProduct(currentPhysicalProduct);
    const productViews = getPhysicalProductViews(product);
    const variant = PHYSICAL_VARIANTS[currentPhysicalVariant] || PHYSICAL_VARIANTS.standard;
    const heroImage = product.id === 'vector_sigil' ? 'assets/vector-sigil-front-hero.png' : product.img;
    const cleanName = escapeHtml(agent.name || 'AGENTE TRIAXIS');
    const cleanRole = escapeHtml(agent.role || 'Agente TriAxis');
    const qrId = escapeHtml(agent.qrId || '—');
    const clearance = escapeHtml(agent.level || 'LVL-02');
    const status = escapeHtml(agent.status || 'Autorizado');
    const internalCode = escapeHtml(buildInternalCode(agent));
    const qrPayload = agent.qrPayload || agent.qrId || `${agent.tag}|${agent.name}`;

    const dataPlate = `
      <aside class="real-id-data-plate">
        <span class="plate-kicker">${escapeHtml(product.name)} // ${escapeHtml(variant.label)}</span>
        <strong>${cleanTag}</strong>
        <p>${cleanName}</p>
        <small>${cleanRole} · ${clearance} · ${status}</small>
      </aside>`;

    const front = `
      <div class="real-id-view real-id-view--front">
        <div class="real-id-photo-frame real-id-photo-frame--front">
          <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(product.name)} TriAxis">
          <span class="real-id-photo-glass" aria-hidden="true"></span>
        </div>
        ${dataPlate}
      </div>`;

    const back = `
      <div class="real-id-view real-id-view--back">
        <div class="real-id-object-card">
          <img class="real-id-object-img real-id-object-img--back" src="${escapeHtml(productViews.back)}" alt="Vista complementar de ${escapeHtml(product.name)}">
          <div class="real-id-live-qr" id="${targetId}Qr"></div>
        </div>
        <aside class="real-id-back-info">
          <span>TRIAXIS VERIFY NODE</span>
          <strong>${cleanTag}</strong>
          <p><b>QR ID</b>${qrId}</p>
          <p><b>NODE</b>${internalCode}</p>
          <small>QR dinâmico do agente sobreposto à foto do produto real.</small>
        </aside>
      </div>`;

    const sideView = `
      <div class="real-id-view real-id-view--side">
        <div class="real-id-object-card real-id-object-card--side">
          <img class="real-id-object-img real-id-object-img--side" src="${escapeHtml(productViews.side)}" alt="Vista lateral de ${escapeHtml(product.name)}">
        </div>
        <aside class="real-id-back-info">
          <span>PRODUCT PROFILE</span>
          <strong>LATERAL</strong>
          <p><b>LED</b>RED EDGE</p>
          <p><b>BODY</b>ABS / RESIN</p>
          <small>Perfil estreito com faixas vermelhas como no produto físico.</small>
        </aside>
      </div>`;

    const concept = `
      <div class="real-id-board">
        <div class="real-id-board__top"><span>VISTAS</span><i></i></div>
        <div class="real-id-board__main">
          <img src="${escapeHtml(productViews.concept)}" alt="Prancha visual de ${escapeHtml(product.name)}">
          <div class="real-id-board__agent">
            <span>${escapeHtml(product.name)} · ${cleanTag}</span>
            <strong>${cleanName}</strong>
            <small>${escapeHtml(variant.label)} // ${clearance} // ${status}</small>
          </div>
        </div>
        <div class="real-id-board__footer">
          <span>| FRENTE</span><span>| VERSO</span><span>| LATERAL</span>
        </div>
      </div>`;

    let html = front;
    if (side === 'back') html = back;
    if (side === 'side') html = sideView;
    if (side === 'concept') html = concept;
    container.innerHTML = html;

    if (side === 'back') renderRealQrCode(`${targetId}Qr`, qrPayload);
  }

  function flipPhysicalKeychain(side) {
    currentPhysicalSide = side || (currentPhysicalSide === 'front' ? 'back' : 'front');
    document.querySelectorAll('[data-keychain-side]').forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-keychain-side') === currentPhysicalSide));
    renderPhysicalKeychainPreview(findAgentByTag(currentPhysicalTag), currentPhysicalSide);
  }

  function openPhysicalIdModal(tag) {
    const validatedAgent = requirePurchaseValidation();
    if (!validatedAgent) return;
    const agent = findAgentByTag(validatedAgent.tag);
    if (!agent) { showToast('SELECIONE UM AGENTE PARA SOLICITAR O ID FÍSICO', 'error'); return; }
    currentPhysicalTag = agent.tag;
    setText('physicalModalAgent', agent.name);
    setText('physicalModalTag', agent.tag);
    setText('physicalModalQrId', agent.qrId);
    setText('physicalModalProduct', getCatalogProduct(currentPhysicalProduct).name);
    setText('physicalModalVariant', getVariantLabel(currentPhysicalVariant));
    const notes = document.getElementById('physicalRequestNotes');
    if (notes) notes.value = '';
    const material = document.getElementById('physicalMaterialSelect');
    const finish = document.getElementById('physicalFinishSelect');
    const accessory = document.getElementById('physicalAccessorySelect');
    if (material) material.value = 'pla_fosco';
    if (finish) finish.value = 'simples';
    if (accessory) accessory.value = 'ball_chain';
    updatePhysicalPricePreview();
    renderPhysicalKeychainPreview(agent, 'concept', 'physicalModalPreview');
    openModal('modalPhysicalId');
  }

  async function requestPhysicalId(tag) {
    if (orderSubmissionPending) return;
    const validatedAgent = requirePurchaseValidation();
    if (!validatedAgent) return;
    const agent = findAgentByTag(validatedAgent.tag);
    if (!agent) { showToast('AGENTE NÃO ENCONTRADO', 'error'); return; }
    const notes = document.getElementById('physicalRequestNotes')?.value.trim() || '';
    const order = getPhysicalOrderSelection();
    const product = getCatalogProduct(order.productId);
    if (!product?.remoteId || !window.TriAxisOrders) {
      showToast('CATÁLOGO ONLINE AINDA NÃO ESTÁ PRONTO. ATUALIZE E TENTE NOVAMENTE.', 'error');
      return;
    }
    const existingOpen = physicalRequests.find(r => r.tag === agent.tag && r.status !== 'Entregue');
    if (existingOpen && !confirm('Já existe uma solicitação aberta para este agente. Criar outra mesmo assim?')) return;
    orderSubmissionPending = true;
    try {
      physicalOrderIntentId = `physical:${agent.id || agent.tag}:${product.remoteId}`;
      await window.TriAxisOrders.submit({
        productId: product.remoteId,
        quantity: 1,
        intentId: physicalOrderIntentId,
        notes,
        configuration: {
          variant: order.productVariant,
          material: order.material,
          finish: order.finish,
          accessory: order.accessory,
          origin: 'id_fisico',
          deadline: product.productionTime || 'sob_consulta'
        }
      });
      closeModal('modalPhysicalId');
      await refreshOrdersFromSupabase();
      renderPhysicalIdView();
      showToast('SOLICITAÇÃO DE ID FÍSICO REGISTRADA');
    } catch (error) {
      console.error('Falha ao registrar pedido online:', error);
      showToast('NÃO FOI POSSÍVEL REGISTRAR O PEDIDO. TENTE NOVAMENTE.', 'error');
    } finally {
      orderSubmissionPending = false;
    }
  }

  function renderPhysicalRequests() {
    const list = document.getElementById('physicalRequestsList');
    if (!list) return;
    if (!physicalRequests.length) {
      list.innerHTML = '<div class="empty-state visible"><div class="empty-icon">▢</div><p>NENHUMA SOLICITAÇÃO REGISTRADA</p><small>Solicite um ID físico pelo banco, busca ou ID digital</small></div>';
      return;
    }
    list.innerHTML = physicalRequests.map(req => `
      <div class="physical-request-card physical-request-card--upgraded">
        <div class="physical-request-main">
          <strong>${escapeHtml(req.name)}</strong>
          <span>${escapeHtml(req.tag)} · ${formatTime(req.requestedAt)}</span>
          <small>QR ID: ${escapeHtml(req.qrId)}</small>
          ${renderPhysicalProgress(req.status)}
        </div>
        <div class="physical-request-specs">
          <p><b>Produto</b><span>${escapeHtml(req.productName || getCatalogProduct(req.productId).name)} · ${escapeHtml(req.productVariantLabel || getVariantLabel(req.productVariant))}</span></p>
          <p><b>Material</b><span>${escapeHtml(req.materialLabel || getPhysicalOptionLabel('material', req.material))}</span></p>
          <p><b>Acabamento</b><span>${escapeHtml(req.finishLabel || getPhysicalOptionLabel('finish', req.finish))}</span></p>
          <p><b>Acessório</b><span>${escapeHtml(req.accessoryLabel || getPhysicalOptionLabel('accessory', req.accessory))}</span></p>
          <p><b>Estimativa</b><span>${formatCurrencyBRL(req.estimatedPrice)}</span></p>
          ${req.notes ? `<p><b>Obs.</b><span>${escapeHtml(req.notes)}</span></p>` : ''}
        </div>
        <select class="toolbar-select" data-request-status="${escapeHtml(req.id)}" ${canAccessProduction() ? '' : 'disabled'}>${renderPhysicalStatusOptions(req)}</select>
        <button class="btn btn-outline btn-sm" data-open-id="${escapeHtml(req.tag)}" type="button">ABRIR ID</button>
        ${req.remote ? '' : `<button class="btn btn-danger btn-sm" data-remove-request="${escapeHtml(req.id)}" type="button">REMOVER</button>`}
      </div>`).join('');
    list.querySelectorAll('[data-request-status]').forEach(sel => sel.addEventListener('change', () => updatePhysicalRequestStatus(sel.getAttribute('data-request-status'), sel.value)));
    list.querySelectorAll('[data-open-id]').forEach(btn => btn.addEventListener('click', () => openIdCard(btn.getAttribute('data-open-id'))));
    list.querySelectorAll('[data-remove-request]').forEach(btn => btn.addEventListener('click', () => removePhysicalRequest(btn.getAttribute('data-remove-request'))));
  }

  async function updatePhysicalRequestStatus(requestId, status) {
    if (!canAccessProduction()) {
      showToast('PERMISSÃO OPERACIONAL NECESSÁRIA', 'error');
      return;
    }
    const req = physicalRequests.find(r => r.id === requestId);
    const remoteStatus = window.TriAxisOrders?.statusFromLabel(status);
    if (!req?.remote || !remoteStatus) {
      showToast('PEDIDO LOCAL LEGADO NÃO PODE ALTERAR A PRODUÇÃO REAL', 'error');
      return;
    }
    const transition = collectOrderTransitionData(req, remoteStatus);
    if (!transition) {
      await refreshOrdersFromSupabase();
      return;
    }
    try {
      await window.TriAxisOrders.setStatus(req.id, remoteStatus, transition.reason, transition.data);
      await refreshOrdersFromSupabase();
      showToast('STATUS DA SOLICITAÇÃO ATUALIZADO');
    } catch (error) {
      console.error('Falha ao atualizar status online:', error);
      await refreshOrdersFromSupabase();
      showToast('TRANSIÇÃO DE STATUS NÃO PERMITIDA', 'error');
    }
  }

  function collectOrderTransitionData(request, targetStatus) {
    const reason = prompt('Motivo desta mudança de status (obrigatório):')?.trim();
    if (!reason || reason.length < 3) {
      showToast('A MUDANÇA EXIGE UM MOTIVO COM PELO MENOS 3 CARACTERES', 'error');
      return null;
    }
    const data = {};
    if (targetStatus === 'payment_received') {
      data.payment_method = prompt('Forma de pagamento:')?.trim() || '';
      data.payment_reference = prompt('Referência única da comprovação:')?.trim() || '';
      data.payment_payer = prompt('Nome do pagador:')?.trim() || '';
      data.payment_amount = Number(String(prompt(`Valor comprovado (total do pedido: ${formatCurrencyBRL(request.estimatedPrice)}):`) || '').replace(',', '.'));
      if (!data.payment_method || !data.payment_reference || !data.payment_payer || !Number.isFinite(data.payment_amount) || data.payment_amount <= 0) {
        showToast('DADOS DA COMPROVAÇÃO INCOMPLETOS', 'error');
        return null;
      }
    }
    if (targetStatus === 'approved_for_production') {
      if (!confirm('Confirma que o pagamento foi validado e existe capacidade de produção para este pedido?')) return null;
      data.capacity_confirmed = true;
    }
    if (targetStatus === 'in_production') {
      data.production_due_at = prompt('Prazo prometido em ISO (ex.: 2026-08-01T18:00:00-03:00):')?.trim() || '';
      if (!data.production_due_at || Number.isNaN(Date.parse(data.production_due_at))) {
        showToast('PRAZO DE PRODUÇÃO INVÁLIDO', 'error');
        return null;
      }
    }
    if (targetStatus === 'shipped' || targetStatus === 'available_for_pickup') {
      data.delivery_method = targetStatus === 'shipped' ? (prompt('Modalidade de envio:')?.trim() || '') : 'retirada';
      data.tracking_code = targetStatus === 'shipped' ? (prompt('Código de rastreio:')?.trim() || '') : '';
      const details = prompt('Dados/instruções de entrega ou retirada:')?.trim() || '';
      data.delivery_details = { instructions: details };
      if (!data.delivery_method || (targetStatus === 'shipped' && !data.tracking_code)) {
        showToast('DADOS DE ENTREGA INCOMPLETOS', 'error');
        return null;
      }
    }
    if (targetStatus === 'refund_pending') {
      data.refund_amount = Number(String(prompt(`Valor solicitado para reembolso (máximo: ${formatCurrencyBRL(request.estimatedPrice)}):`) || '').replace(',', '.'));
      data.refund_recipient = prompt('Destinatário do reembolso:')?.trim() || '';
      if (!Number.isFinite(data.refund_amount) || data.refund_amount <= 0 || data.refund_amount > Number(request.estimatedPrice || 0) || !data.refund_recipient) {
        showToast('DADOS DA SOLICITAÇÃO DE REEMBOLSO INCOMPLETOS', 'error');
        return null;
      }
    }
    if (targetStatus === 'refunded') {
      data.refund_reference = prompt('Referência única do reembolso processado:')?.trim() || '';
      data.refund_processed_at = prompt('Data e hora do processamento em ISO:', new Date().toISOString())?.trim() || '';
      if (!data.refund_reference || !data.refund_processed_at || Number.isNaN(Date.parse(data.refund_processed_at))) {
        showToast('EVIDÊNCIA DO REEMBOLSO INCOMPLETA', 'error');
        return null;
      }
    }
    if (targetStatus === 'cancelled' && ['in_production', 'production_suspended'].includes(request.remoteStatus)) {
      data.decision_reference = prompt('Referência da decisão explícita de cancelamento:')?.trim() || '';
      if (!data.decision_reference) {
        showToast('CANCELAMENTO EM PRODUÇÃO EXIGE DECISÃO EXPLÍCITA', 'error');
        return null;
      }
    }
    return { reason, data };
  }

  function renderOrderHistory(request) {
    if (!Array.isArray(request?.history) || !request.history.length) return '';
    return `<details class="production-history"><summary>HISTÓRICO OPERACIONAL (${request.history.length})</summary>${request.history.map((item) => `
      <p><b>${escapeHtml(window.TriAxisOrders?.labelForStatus?.(item.to_status) || item.to_status)}</b><span>${formatDate(item.created_at)} · ${formatTime(item.created_at)} · ${escapeHtml(item.reason)}</span></p>`).join('')}</details>`;
  }

  function removePhysicalRequest(requestId) {
    if (!requireAdminMode()) return;
    const req = physicalRequests.find(r => r.id === requestId);
    if (!req) return;
    if (req.remote) {
      showToast('PEDIDOS REAIS NÃO PODEM SER APAGADOS; USE O STATUS CANCELADO.', 'error');
      return;
    }
    if (!confirm(`Remover solicitação física de ${req.name} (${req.tag})?`)) return;
    const previousRequests = physicalRequests;
    physicalRequests = physicalRequests.filter(r => r.id !== requestId);
    if (!savePhysicalIdRequests()) {
      physicalRequests = previousRequests;
      return;
    }
    renderPhysicalRequests();
    renderProduction();
    addLog(`SOLICITAÇÃO FÍSICA REMOVIDA · ${req.tag}`);
    showToast('SOLICITAÇÃO REMOVIDA');
  }




  /* ── Validação de tag para compra ─────────────────────────────────── */
  function loadValidatedPurchaseTag() {
    try {
      const stored = localStorage.getItem(PURCHASE_TAG_KEY);
      if (stored && findAgentByTag(stored)) return stored;
      localStorage.removeItem(PURCHASE_TAG_KEY);
    } catch (e) {}
    return null;
  }

  function getValidatedPurchaseAgent() {
    return getLoggedAgent();
  }

  function saveValidatedPurchaseTag(tag) {
    validatedPurchaseTag = getLoggedAgent()?.tag || null;
    try { localStorage.removeItem(PURCHASE_TAG_KEY); } catch (e) {}
  }

  function updatePurchaseGateUi() {
    const agent = getValidatedPurchaseAgent();
    const gate = document.getElementById('catalogAccessGate');
    const status = document.getElementById('purchaseTagStatus');
    const input = document.getElementById('purchaseTagInput');
    const mini = document.getElementById('purchaseTagAgentMini');
    if (gate) gate.classList.toggle('validated', Boolean(agent));
    if (status) {
      status.className = `catalog-access-status ${agent ? 'catalog-access-status--ok' : 'catalog-access-status--locked'}`;
      status.textContent = agent
        ? `SESSÃO AUTENTICADA // SOLICITAÇÃO LIBERADA · ${agent.name.toUpperCase()} · ${agent.tag}`
        : 'SOLICITAÇÕES BLOQUEADAS · FAÇA LOGIN';
    }
    if (mini) {
      mini.textContent = agent
        ? `AGENTE VINCULADO: ${agent.name.toUpperCase()} · ${agent.tag} · ${agent.level || 'LVL-02'} · ${agent.status || 'Autorizado'}`
        : 'AGENTE VINCULADO: NENHUM · Entre na sua conta para liberar solicitações.';
    }
    if (input) {
      input.value = agent?.tag || '';
      input.readOnly = true;
      input.placeholder = agent ? agent.tag : 'Login necessário';
    }

    const canBuy = Boolean(agent);
    document.querySelectorAll('[data-catalog-config], [data-request-physical], #btnQuoteCreate, #btnRequestPhysicalFromView, #btnConfirmPhysicalRequest, #btnBankModalRequestPhysical, #btnRequestPhysicalFromId').forEach((btn) => {
      if (!btn) return;
      btn.disabled = !canBuy;
      btn.classList.toggle('btn-locked', !canBuy);
      btn.setAttribute('aria-disabled', String(!canBuy));
      if (btn.dataset.catalogConfig !== undefined) {
        btn.title = canBuy ? 'Solicitação liberada por sessão autenticada' : 'Faça login para liberar esta solicitação';
        const isFeatured = btn.closest('#catalogFeatured');
        if (!isFeatured) btn.textContent = canBuy ? 'SOLICITAR ARTEFATO' : 'VALIDAÇÃO NECESSÁRIA';
      }
    });
  }

  function validatePurchaseTag() {
    const agent = getLoggedAgent();
    if (agent) {
      updatePurchaseGateUi();
      showToast(`SESSÃO AUTENTICADA · ${agent.tag}`);
      return agent;
    }
    updatePurchaseGateUi();
    showToast('FAÇA LOGIN PARA SOLICITAR ARTEFATOS', 'error');
    switchView('profile');
    openLoginPanel();
    return null;
  }

  function clearPurchaseTagValidation() {
    showToast('A AUTORIZAÇÃO DE COMPRA AGORA SEGUE A SESSÃO DA CONTA');
  }

  function requirePurchaseValidation() {
    const agent = getLoggedAgent();
    if (agent) return agent;
    updatePurchaseGateUi();
    showToast('ACESSO BLOQUEADO · FAÇA LOGIN ANTES DE SOLICITAR ARTEFATOS', 'error');
    switchView('profile');
    openLoginPanel();
    return null;
  }

  /* ── Login por tag + senha com hash local ─────────────────────────── */
  function loadPasswordVault() {
    try {
      const raw = localStorage.getItem(PASSWORD_HASH_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      console.warn('Falha ao carregar cofre de senhas:', e);
      return {};
    }
  }

  function savePasswordVault(vault) {
    try {
      localStorage.setItem(PASSWORD_HASH_KEY, JSON.stringify(vault || {}));
      return true;
    } catch (e) {
      console.error('Falha ao salvar cofre de senhas:', e);
      showToast('ERRO AO SALVAR HASH DA SENHA', 'error');
      return false;
    }
  }


  function loadLoginAttempts() {
    try {
      const raw = localStorage.getItem(LOGIN_ATTEMPT_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      console.warn('Falha ao carregar tentativas de login:', e);
      return {};
    }
  }

  function saveLoginAttempts(attempts) {
    try {
      localStorage.setItem(LOGIN_ATTEMPT_KEY, JSON.stringify(attempts || {}));
      return true;
    } catch (e) {
      console.warn('Falha ao salvar tentativas de login:', e);
      return false;
    }
  }

  function getLoginAttemptState(tag) {
    const normalizedTag = normalizeTagInput(tag);
    const attempts = loadLoginAttempts();
    const record = attempts[normalizedTag] || { count: 0, lockedUntil: 0 };
    const now = Date.now();
    const lockedUntil = Number(record.lockedUntil || 0);
    const isLocked = lockedUntil > now;
    if (!isLocked && lockedUntil) {
      delete attempts[normalizedTag];
      saveLoginAttempts(attempts);
      return { count: 0, remaining: LOGIN_MAX_ATTEMPTS, locked: false, lockedUntil: 0, waitMs: 0 };
    }
    const count = Math.max(0, Number(record.count || 0));
    return {
      count,
      remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - count),
      locked: isLocked,
      lockedUntil,
      waitMs: isLocked ? lockedUntil - now : 0
    };
  }

  function clearLoginAttempts(tag) {
    const normalizedTag = normalizeTagInput(tag);
    const attempts = loadLoginAttempts();
    if (attempts[normalizedTag]) {
      delete attempts[normalizedTag];
      saveLoginAttempts(attempts);
    }
  }

  function formatLockTime(ms) {
    const seconds = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
    return `${seconds}s`;
  }

  function registerFailedLoginAttempt(tag) {
    const normalizedTag = normalizeTagInput(tag);
    const attempts = loadLoginAttempts();
    const current = attempts[normalizedTag] || { count: 0, lockedUntil: 0, lastFailedAt: 0 };
    const now = Date.now();
    const nextCount = Number(current.lockedUntil || 0) > now ? LOGIN_MAX_ATTEMPTS : Number(current.count || 0) + 1;
    const shouldLock = nextCount >= LOGIN_MAX_ATTEMPTS;
    attempts[normalizedTag] = {
      count: shouldLock ? LOGIN_MAX_ATTEMPTS : nextCount,
      lastFailedAt: now,
      lockedUntil: shouldLock ? now + LOGIN_LOCK_MS : 0
    };
    saveLoginAttempts(attempts);
    return getLoginAttemptState(normalizedTag);
  }

  function randomHex(bytes = 16) {
    const array = new Uint8Array(bytes);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(array);
    } else {
      for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(text) {
    if (window.crypto?.subtle && window.TextEncoder) {
      const data = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback apenas para navegadores antigos; browsers atuais usam crypto.subtle.
    return Math.abs(hashString(text)).toString(16).padStart(64, '0').slice(0, 64);
  }

  function getPasswordRecord(tag) {
    const vault = loadPasswordVault();
    return vault[normalizeTagInput(tag)] || null;
  }

  const PASSWORD_KDF_ITERATIONS = 250000;

  async function pbkdf2Hex(password, salt, iterations = PASSWORD_KDF_ITERATIONS) {
    if (!window.crypto?.subtle || !window.TextEncoder) throw new Error('Web Crypto indisponível');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
    const saltBytes = new Uint8Array((String(salt || '').match(/.{2}/g) || []).map(pair => parseInt(pair, 16)));
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, material, 256);
    return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function hashPasswordForAgent(tag, password, salt) {
    const normalizedTag = normalizeTagInput(tag);
    return pbkdf2Hex(`TRIAXIS::ACCESS::${normalizedTag}::${password}`, salt);
  }

  async function createPasswordRecord(tag, password) {
    const normalizedTag = normalizeTagInput(tag);
    const vault = loadPasswordVault();
    const salt = randomHex(16);
    const hash = await hashPasswordForAgent(normalizedTag, password, salt);
    vault[normalizedTag] = {
      algo: 'PBKDF2-SHA-256',
      iterations: PASSWORD_KDF_ITERATIONS,
      salt,
      hash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!savePasswordVault(vault)) return null;
    return vault[normalizedTag];
  }

  async function verifyPasswordRecord(tag, password) {
    const record = getPasswordRecord(tag);
    if (!record?.salt || !record?.hash) return false;
    if (record.algo === 'PBKDF2-SHA-256') {
      const iterations = Number(record.iterations);
      if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
      const hash = await pbkdf2Hex(`TRIAXIS::ACCESS::${normalizeTagInput(tag)}::${password}`, record.salt, iterations);
      return hash === record.hash;
    }
    const legacyHash = await sha256Hex(`TRIAXIS::ACCESS::${normalizeTagInput(tag)}::${record.salt}::${password}`);
    if (legacyHash !== record.hash) return false;
    return Boolean(await createPasswordRecord(tag, password));
  }

  function mapRemoteProfileToAgent(profile = remoteAuthState.profile) {
    if (!profile?.id || !profile?.tag) return null;
    const isAdmin = remoteAuthState.roles.includes('admin');
    return normalizeAgent({
      id: profile.id,
      tag: profile.tag,
      name: profile.display_name,
      phone: profile.phone || '',
      photo: null,
      role: isAdmin ? 'Administrador TriAxis' : 'Cliente TriAxis',
      level: isAdmin ? 'ADMIN' : 'LVL-02',
      status: profile.status === 'active' ? 'Autorizado' : 'Bloqueado',
      notes: 'Perfil autenticado pelo Supabase.',
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
      qrId: profile.tag,
      qrPayload: `TRIAXIS|AGENT|${profile.tag}`
    });
  }

  function getLoggedAgent() {
    return mapRemoteProfileToAgent();
  }

  function hasRemoteRole(role) {
    return remoteAuthState.roles.includes(role);
  }

  function canAccessProduction() {
    return remoteAuthState.roles.some((role) => ['admin', 'commercial', 'finance', 'operations', 'production', 'logistics', 'support'].includes(role));
  }

  function legacyPiiKeys() {
    return [STORAGE_KEY, PHYSICAL_REQUESTS_KEY, LEGACY_AGENTS_KEY, LEGACY_REQUESTS_KEY, LOGIN_SESSION_KEY, PASSWORD_HASH_KEY, LOGIN_ATTEMPT_KEY, PURCHASE_TAG_KEY, LOG_KEY];
  }

  function clearRuntimeLocalPii() {
    try { legacyPiiKeys().forEach((key) => localStorage.removeItem(key)); } catch (error) {}
    try { sessionStorage.removeItem(LOG_KEY); } catch (error) {}
  }

  async function remediateLegacyLocalPii() {
    const snapshot = getStorageSnapshot(legacyPiiKeys());
    if (!Object.values(snapshot).some((value) => value !== null)) return true;
    if (!confirm('MIGRAÇÃO DE SEGURANÇA: existem dados pessoais locais legados. Clique OK para criar um backup criptografado antes da remoção. Cancelar preserva os dados, bloqueia o aplicativo e não os mostra na tela.')) {
      document.body.dataset.legacyMigrationBlocked = 'true';
      alert('Migração cancelada. Os dados foram preservados localmente e o aplicativo permanecerá bloqueado até a exportação segura.');
      return false;
    }
    const password = prompt('Crie uma senha forte para o backup legado (mínimo de 12 caracteres):');
    if (!password || password.length < 12 || prompt('Confirme a senha do backup legado:') !== password) {
      document.body.dataset.legacyMigrationBlocked = 'true';
      alert('Backup não criado. Os dados foram preservados e o aplicativo permanece bloqueado.');
      return false;
    }
    try {
      const envelope = await encryptBackupPayload({ version: 5, kind: 'triaxis-legacy-export', exportedAt: new Date().toISOString(), rawStorage: snapshot }, password);
      downloadEncryptedBackup(envelope, `triaxis-legacy-encrypted-${Date.now()}.json`);
    } catch (error) {
      console.error('Falha ao criptografar dados legados:', error);
      document.body.dataset.legacyMigrationBlocked = 'true';
      alert('Falha ao criar backup. Nenhum dado foi removido e o aplicativo permanece bloqueado.');
      return false;
    }
    if (!confirm('Confirme que o arquivo criptografado foi gerado/baixado. Somente então os dados locais legados serão apagados.')) {
      document.body.dataset.legacyMigrationBlocked = 'true';
      alert('Remoção cancelada. Os dados continuam preservados localmente.');
      return false;
    }
    clearRuntimeLocalPii();
    return true;
  }

  function applyRemoteAuthState(state) {
    const nextUserId = state?.session?.user?.id || null;
    const userChanged = previousRemoteUserId !== null && previousRemoteUserId !== nextUserId;
    if (userChanged) {
      ++orderRefreshSequence;
      physicalRequests = [];
      agents = [];
      currentPhysicalTag = null;
      validatedPurchaseTag = null;
      loggedAgentTag = null;
      window.TriAxisOrders?.clearAllIntents?.();
      renderPhysicalRequests();
      renderProduction();
      renderUserProfile();
    }
    previousRemoteUserId = nextUserId;
    remoteAuthState = {
      session: state?.session || null,
      profile: state?.profile || null,
      roles: Array.isArray(state?.roles) ? [...state.roles] : []
    };
    const agent = getLoggedAgent();
    loggedAgentTag = agent?.tag || null;
    validatedPurchaseTag = agent?.tag || null;
    if (!remoteAuthState.session?.user?.id) {
      physicalRequests = [];
      window.TriAxisOrders?.clearAllIntents?.();
      try { sessionStorage.removeItem(LOG_KEY); } catch (e) {}
    } else {
      window.TriAxisOrders?.purgeExpiredIntents?.();
    }
    const settings = loadSettings();
    settings.mode = hasRemoteRole('admin') ? 'admin' : 'client';
    saveSettings(settings);
    applySettings(settings);
    updatePurchaseGateUi();
    renderLoginState();
    renderAllDynamic();
    void refreshCatalogFromSupabase();
    void refreshOrdersFromSupabase();
  }

  async function refreshOrdersFromSupabase() {
    const sequence = ++orderRefreshSequence;
    if (!remoteAuthState.session?.user?.id || !window.TriAxisOrders) {
      physicalRequests = [];
      renderPhysicalRequests();
      renderProduction();
      renderUserProfile();
      return false;
    }
    try {
      const orders = await window.TriAxisOrders.load();
      if (sequence !== orderRefreshSequence) return false;
      physicalRequests = Array.isArray(orders) ? orders.map(normalizePhysicalRequest) : [];
      renderPhysicalRequests();
      renderProduction();
      renderUserProfile();
      return true;
    } catch (error) {
      console.error('Falha ao carregar pedidos protegidos pelo Supabase:', error);
      if (sequence === orderRefreshSequence) physicalRequests = [];
      renderPhysicalRequests();
      renderProduction();
      renderUserProfile();
      return false;
    }
  }

  function hasNumberSequence(password) {
    const digits = String(password || '').match(/\d/g) || [];
    for (let i = 1; i < digits.length; i++) {
      const prev = Number(digits[i - 1]);
      const curr = Number(digits[i]);
      if (Math.abs(curr - prev) === 1) return true;
    }
    return false;
  }

  function validateAccessPassword(password) {
    const value = String(password || '');
    const digits = (value.match(/\d/g) || []).length;
    const symbols = (value.match(/[^A-Za-z0-9]/g) || []).length;
    const upper = (value.match(/[A-Z]/g) || []).length;
    const lower = (value.match(/[a-z]/g) || []).length;
    const letters = upper + lower;
    const noSequence = !hasNumberSequence(value);
    return {
      len: value.length >= 8 && value.length <= 72,
      nums: digits >= 1,
      symbols: symbols >= 1,
      letters: upper >= 1 && lower >= 1,
      seq: noSequence,
      valid: value.length >= 8 && value.length <= 72 && digits >= 1 && symbols >= 1 && upper >= 1 && lower >= 1 && noSequence
    };
  }

  function updateLoginRules() {
    const password = document.getElementById('loginPasswordInput')?.value || '';
    const result = validateAccessPassword(password);
    const map = { ruleLen: result.len, ruleNums: result.nums, ruleSymbols: result.symbols, ruleLetters: result.letters, ruleSeq: result.seq };
    Object.entries(map).forEach(([id, ok]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('ok', Boolean(ok));
      el.classList.toggle('bad', password.length > 0 && !ok);
    });
    return result;
  }

  function setLoginStatus(message, state = '') {
    const el = document.getElementById('loginStatusText');
    if (!el) return;
    el.textContent = message;
    el.className = `login-status-text ${state}`.trim();
  }

  function setCreateLoginStatus(message, state = '') {
    const el = document.getElementById('createLoginStatusText');
    if (!el) return;
    el.textContent = message;
    el.className = `login-status-text ${state}`.trim();
  }

  function setRecoveryStatus(message, state = '') {
    const el = document.getElementById('recoveryStatusText');
    if (!el) return;
    el.textContent = message;
    el.className = `login-status-text ${state}`.trim();
  }

  function setLoginMode(mode = 'enter') {
    if (passwordRecoveryMode && mode !== 'recovery') return;
    const normalizedMode = mode === 'create' ? 'create' : 'enter';
    const loginForm = document.getElementById('formTagLogin');
    const createForm = document.getElementById('formCreateLoginId');
    const enterTab = document.getElementById('btnLoginModeEnter');
    const createTab = document.getElementById('btnLoginModeCreate');
    const panel = document.getElementById('loginPanel');
    const creating = normalizedMode === 'create';
    if (panel) panel.setAttribute('data-login-mode', normalizedMode);
    if (loginForm) {
      loginForm.hidden = creating || Boolean(getLoggedAgent());
      loginForm.setAttribute('aria-hidden', String(creating || Boolean(getLoggedAgent())));
    }
    if (createForm) {
      createForm.hidden = !creating || Boolean(getLoggedAgent());
      createForm.setAttribute('aria-hidden', String(!creating || Boolean(getLoggedAgent())));
    }
    enterTab?.classList.toggle('active', !creating);
    createTab?.classList.toggle('active', creating);
    enterTab?.setAttribute('aria-selected', String(!creating));
    createTab?.setAttribute('aria-selected', String(creating));
    if (creating) {
      if (createForm) createForm.scrollTop = 0;
      updateCreateIdPasswordRules();
      setCreateLoginStatus('Preencha e-mail, nome, senha e telefone para criar o acesso.');
      setTimeout(() => document.getElementById('createLoginEmailInput')?.focus(), 80);
    } else {
      updateLoginRules();
      setLoginStatus('Aguardando credenciais.');
      setTimeout(() => document.getElementById('loginTagInput')?.focus(), 80);
    }
  }

  function updateRecoveryPasswordRules() {
    const password = document.getElementById('recoveryPasswordInput')?.value || '';
    const result = validateAccessPassword(password);
    applyPasswordRuleClasses(result, {
      len: 'recoveryRuleLen',
      nums: 'recoveryRuleNums',
      symbols: 'recoveryRuleSymbols',
      letters: 'recoveryRuleLetters',
      seq: 'recoveryRuleSeq'
    }, password);
    return result;
  }

  function hasAuthenticatedRecoverySession(session) {
    return Boolean(session?.user?.id || window.TriAxisAuth?.getState?.()?.session?.user?.id);
  }

  function enterPasswordRecoveryMode(session = null) {
    if (!hasAuthenticatedRecoverySession(session)) return false;
    passwordRecoveryMode = true;
    const panel = document.getElementById('loginPanel');
    const recoveryForm = document.getElementById('formPasswordRecovery');
    const loginForm = document.getElementById('formTagLogin');
    const createForm = document.getElementById('formCreateLoginId');
    const loggedCard = document.getElementById('loginLoggedCard');
    const tabs = document.querySelector('.login-mode-tabs');
    if (panel) panel.setAttribute('data-login-mode', 'recovery');
    if (recoveryForm) {
      recoveryForm.hidden = false;
      recoveryForm.setAttribute('aria-hidden', 'false');
      recoveryForm.scrollTop = 0;
    }
    if (loginForm) loginForm.hidden = true;
    if (createForm) createForm.hidden = true;
    if (loggedCard) loggedCard.hidden = true;
    if (tabs) tabs.hidden = true;
    updateRecoveryPasswordRules();
    setRecoveryStatus('Informe e confirme sua nova senha.');
    switchView('profile');
    openLoginPanel();
    window.setTimeout(() => document.getElementById('recoveryPasswordInput')?.focus(), 80);
    return true;
  }

  function getHashSearchParams(url) {
    const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    return rawHash && (rawHash.includes('=') || rawHash.includes('&'))
      ? new URLSearchParams(rawHash)
      : null;
  }

  function isValidRecoveryCredential(value) {
    const normalized = String(value || '').trim();
    return normalized.length >= 8 && normalized.length <= 4096 && /^[A-Za-z0-9._~+/=-]+$/.test(normalized);
  }

  function hasPasswordRecoveryUrlMarker() {
    try {
      const current = new URL(window.location.href);
      const hashParams = getHashSearchParams(current);
      const type = current.searchParams.get('type') || hashParams?.get('type') || '';
      return String(type).toLowerCase() === 'recovery';
    } catch (error) {
      return false;
    }
  }

  function capturePasswordRecoveryUrlIntent() {
    let current;
    try {
      current = new URL(window.location.href);
    } catch (error) {
      return null;
    }
    const hashParams = getHashSearchParams(current);
    const getParam = (key) => current.searchParams.get(key) || hashParams?.get(key) || '';
    if (String(getParam('type')).toLowerCase() !== 'recovery') return null;

    const tokenHash = getParam('token_hash');
    if (isValidRecoveryCredential(tokenHash)) return Object.freeze({ kind: 'token_hash', tokenHash });
    const code = getParam('code');
    if (isValidRecoveryCredential(code)) return Object.freeze({ kind: 'code', code });
    const accessToken = getParam('access_token');
    const refreshToken = getParam('refresh_token');
    if (isValidRecoveryCredential(accessToken) && isValidRecoveryCredential(refreshToken)) {
      return Object.freeze({ kind: 'implicit', accessToken, refreshToken });
    }
    return null;
  }

  function cleanPasswordRecoveryUrlCredentials() {
    let current;
    try {
      current = new URL(window.location.href);
    } catch (error) {
      return;
    }
    const sensitiveKeys = [
      'type', 'access_token', 'refresh_token', 'token_hash', 'code',
      'expires_in', 'expires_at', 'token_type'
    ];
    sensitiveKeys.forEach((key) => current.searchParams.delete(key));
    const hashParams = getHashSearchParams(current);
    if (hashParams) {
      sensitiveKeys.forEach((key) => hashParams.delete(key));
      const cleanHash = hashParams.toString();
      current.hash = cleanHash ? `#${cleanHash}` : '';
    }
    window.history.replaceState(window.history.state, document.title, `${current.pathname}${current.search}${current.hash}`);
  }

  function consumePasswordRecoveryUrlError() {
    let current;
    try {
      current = new URL(window.location.href);
    } catch (error) {
      return false;
    }

    const errorKeys = ['error', 'error_code', 'error_description'];
    const queryHasError = errorKeys.some((key) => current.searchParams.has(key));
    let hashParams = null;
    let hashHasError = false;
    const rawHash = current.hash.startsWith('#') ? current.hash.slice(1) : current.hash;
    if (rawHash && (rawHash.includes('=') || rawHash.includes('&'))) {
      hashParams = new URLSearchParams(rawHash);
      hashHasError = errorKeys.some((key) => hashParams.has(key));
    }
    if (!queryHasError && !hashHasError) return false;

    errorKeys.forEach((key) => current.searchParams.delete(key));
    if (hashParams) {
      errorKeys.forEach((key) => hashParams.delete(key));
      const cleanHash = hashParams.toString();
      current.hash = cleanHash ? `#${cleanHash}` : '';
    }
    window.history.replaceState(window.history.state, document.title, `${current.pathname}${current.search}${current.hash}`);
    return true;
  }

  function showPasswordRecoveryUrlError() {
    passwordRecoveryMode = false;
    passwordRecoveryLinkError = true;
    switchView('profile');
    setLoginMode('enter');
    openLoginPanel();
    setLoginStatus('LINK DE RECUPERAÇÃO INVÁLIDO OU EXPIRADO. SOLICITE UM NOVO LINK.', 'error');
    showToast('LINK DE RECUPERAÇÃO INVÁLIDO OU EXPIRADO', 'error');
  }

  function getPasswordRecoveryRedirectUrl() {
    try {
      const current = new URL(window.location.href);
      if (['http:', 'https:'].includes(current.protocol)) {
        current.search = '';
        current.hash = '';
        return current.href;
      }
    } catch (error) {}
    return window.TRIAXIS_SUPABASE_CONFIG?.publicSiteUrl || 'https://apenassamp-dot.github.io/TriAxiS/';
  }

  async function requestPasswordRecovery() {
    if (passwordResetRequestPending) return;
    const emailInput = document.getElementById('loginTagInput');
    const button = document.getElementById('btnForgotPassword');
    const email = String(emailInput?.value || '').trim().toLowerCase();
    if (Date.now() < passwordResetCooldownUntil) {
      setLoginStatus('AGUARDE UM INSTANTE ANTES DE SOLICITAR OUTRO LINK.', 'error');
      return;
    }
    if (!isValidSignupEmail(email) || !emailInput?.checkValidity()) {
      setLoginStatus('INFORME SEU E-MAIL PARA RECEBER O LINK DE RECUPERAÇÃO.', 'error');
      emailInput?.focus();
      return;
    }

    passwordResetRequestPending = true;
    if (button) button.disabled = true;
    setLoginStatus('SOLICITANDO LINK DE RECUPERAÇÃO...', '');
    try {
      if (!window.TriAxisAuth) throw new Error('Serviço de autenticação indisponível');
      await window.TriAxisAuth.requestPasswordReset(email, getPasswordRecoveryRedirectUrl());
      passwordResetCooldownUntil = Date.now() + 60_000;
      const neutralMessage = 'SE HOUVER UMA CONTA COM ESTE E-MAIL, ENVIAREMOS UM LINK DE RECUPERAÇÃO.';
      setLoginStatus(neutralMessage, 'ok');
      showToast('SE A CONTA EXISTIR, O LINK SERÁ ENVIADO');
    } catch (error) {
      passwordResetCooldownUntil = Date.now() + 15_000;
      console.error('Falha operacional ao solicitar recuperação de senha.');
      setLoginStatus('NÃO FOI POSSÍVEL SOLICITAR O LINK AGORA. AGUARDE E TENTE NOVAMENTE.', 'error');
      showToast('SERVIÇO DE RECUPERAÇÃO TEMPORARIAMENTE INDISPONÍVEL', 'error');
    } finally {
      passwordResetRequestPending = false;
      if (button) button.disabled = false;
    }
  }

  async function handlePasswordRecoverySubmit(event) {
    event.preventDefault();
    if (passwordUpdatePending) return;
    const passwordInput = document.getElementById('recoveryPasswordInput');
    const confirmationInput = document.getElementById('recoveryPasswordConfirmInput');
    const submitButton = document.getElementById('btnSubmitPasswordRecovery');
    const password = passwordInput?.value || '';
    const confirmation = confirmationInput?.value || '';
    const passwordCheck = updateRecoveryPasswordRules();

    if (!hasAuthenticatedRecoverySession()) {
      passwordRecoveryMode = false;
      showPasswordRecoveryUrlError();
      return;
    }

    if (!passwordCheck.valid) {
      setRecoveryStatus('SENHA INVÁLIDA · USE 8 OU MAIS CARACTERES, COM MAIÚSCULA, MINÚSCULA, NÚMERO E SÍMBOLO.', 'error');
      passwordInput?.focus();
      return;
    }
    if (password !== confirmation) {
      setRecoveryStatus('AS SENHAS NÃO CONFEREM.', 'error');
      confirmationInput?.focus();
      return;
    }

    passwordUpdatePending = true;
    if (submitButton) submitButton.disabled = true;
    setRecoveryStatus('ATUALIZANDO SENHA COM SEGURANÇA...', '');
    try {
      if (!window.TriAxisAuth) throw new Error('Serviço de autenticação indisponível');
      await window.TriAxisAuth.updatePassword(password);
      if (passwordInput) passwordInput.value = '';
      if (confirmationInput) confirmationInput.value = '';
      passwordRecoveryMode = false;
      setRecoveryStatus('SENHA ATUALIZADA COM SUCESSO.', 'ok');
      showToast('SENHA ATUALIZADA · SUA CONTA FOI MANTIDA');
      renderLoginState();
      closeLoginPanel();
      switchView('profile');
    } catch (error) {
      console.error('Falha ao atualizar senha:', error);
      setRecoveryStatus('NÃO FOI POSSÍVEL ATUALIZAR A SENHA. SOLICITE UM NOVO LINK E TENTE NOVAMENTE.', 'error');
      showToast('LINK INVÁLIDO OU EXPIRADO', 'error');
    } finally {
      passwordUpdatePending = false;
      if (submitButton) submitButton.disabled = false;
    }
  }

  function handleRemoteAuthEvent(event, session) {
    if (event === 'PASSWORD_RECOVERY' && !passwordRecoveryUrlProcessing) enterPasswordRecoveryMode(session);
  }

  function updateCreateLoginTagPreview(forceNew = false) {
    const el = document.getElementById('createLoginTagPreview');
    if (forceNew || !currentTag || findAgentByTag(currentTag)) {
      setCurrentTag(generateUniqueTag());
    }
    if (el) el.textContent = currentTag;
    return currentTag;
  }

  function applyPasswordRuleClasses(result, ids, password) {
    Object.entries(ids).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const ok = Boolean(result[key]);
      el.classList.toggle('ok', ok);
      el.classList.toggle('bad', password.length > 0 && !ok);
    });
  }

  function updateCreateIdPasswordRules() {
    const password = document.getElementById('createLoginPasswordInput')?.value || '';
    const result = validateAccessPassword(password);
    applyPasswordRuleClasses(result, {
      len: 'createRuleLen',
      nums: 'createRuleNums',
      symbols: 'createRuleSymbols',
      letters: 'createRuleLetters',
      seq: 'createRuleSeq'
    }, password);
    return result;
  }

  async function handleCreateLoginIdSubmit(e) {
    e.preventDefault();
    const authStartedAt = Date.now();
    const nameInput = document.getElementById('createLoginNameInput');
    const emailInput = document.getElementById('createLoginEmailInput');
    const phoneInput = document.getElementById('createLoginPhoneInput');
    const passInput = document.getElementById('createLoginPasswordInput');
    const name = (nameInput?.value || '').trim();
    const email = (emailInput?.value || '').trim().toLowerCase();
    const phone = (phoneInput?.value || '').trim();
    const passCheck = updateCreateIdPasswordRules();

    if (!isValidSignupEmail(email) || !emailInput?.checkValidity()) {
      setCreateLoginStatus('INFORME UM E-MAIL VÁLIDO.', 'error');
      showToast('E-MAIL INVÁLIDO', 'error');
      emailInput?.focus();
      return;
    }
    if (!name || name.length > 120) {
      setCreateLoginStatus('INFORME O NOME DO AGENTE PARA CRIAR O ID.', 'error');
      showToast('NOME OBRIGATÓRIO PARA CRIAR ID', 'error');
      nameInput?.focus();
      return;
    }
    if (!passCheck.valid) {
      setCreateLoginStatus('SENHA INVÁLIDA · USE 8 OU MAIS CARACTERES, COM MAIÚSCULA, MINÚSCULA, NÚMERO E SÍMBOLO.', 'error');
      showToast('SENHA FORA DO PADRÃO TRIAXIS', 'error');
      passInput?.focus();
      return;
    }
    if (!phone || !/^[0-9+() .-]{8,32}$/.test(phone)) {
      setCreateLoginStatus('INFORME O TELEFONE PARA CRIAR O ID TRIAXIS.', 'error');
      showToast('TELEFONE OBRIGATÓRIO PARA CRIAR ID', 'error');
      phoneInput?.focus();
      return;
    }

    try {
      if (!window.TriAxisAuth) throw new Error('Serviço de autenticação indisponível');
      setCreateLoginStatus('CRIANDO CONTA SEGURA...', '');
      const result = await window.TriAxisAuth.signUp({
        email,
        password: passInput?.value || '',
        displayName: name,
        phone
      });
      await waitForNeutralAuthTiming(authStartedAt);

      if (result.session) {
        setCreateLoginStatus('CONTA CRIADA · SESSÃO AUTENTICADA.', 'ok');
        showToast('CONTA TRIAXIS CRIADA');
        closeLoginPanel();
        switchView('profile');
      } else {
        setCreateLoginStatus('CONTA CRIADA · CONFIRME O E-MAIL PARA ENTRAR.', 'ok');
        showToast('VERIFIQUE SEU E-MAIL PARA ATIVAR A CONTA');
        setLoginMode('enter');
        const loginEmail = document.getElementById('loginTagInput');
        if (loginEmail) loginEmail.value = email;
      }

      if (passInput) passInput.value = '';
      if (nameInput) nameInput.value = '';
      if (emailInput) emailInput.value = '';
      if (phoneInput) phoneInput.value = '';
    } catch (err) {
      await waitForNeutralAuthTiming(authStartedAt);
      console.error('Falha operacional ao concluir cadastro.');
      const friendly = 'NÃO FOI POSSÍVEL CONCLUIR O CADASTRO. CONFIRA OS DADOS OU TENTE ENTRAR/RECUPERAR A SENHA.';
      setCreateLoginStatus(friendly, 'error');
      showToast(friendly, 'error');
    }
  }

  function isValidSignupEmail(email) {
    const value = String(email || '').trim();
    if (!value || value.length > 254 || /\s/.test(value)) return false;
    const parts = value.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    return parts[1].includes('.') && !parts[1].startsWith('.') && !parts[1].endsWith('.');
  }

  async function waitForNeutralAuthTiming(startedAt, minimumMs = 650) {
    const remaining = minimumMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }

  function renderLoginState() {
    const agent = getLoggedAgent();
    const widget = document.getElementById('loginAccessWidget');
    const loggedCard = document.getElementById('loginLoggedCard');
    const loginButtonText = document.querySelector('#btnLoginAccess .login-access-text');
    const form = document.getElementById('formTagLogin');
    const name = document.getElementById('loginLoggedName');
    const tag = document.getElementById('loginLoggedTag');
    const createForm = document.getElementById('formCreateLoginId');
    const recoveryForm = document.getElementById('formPasswordRecovery');
    const tabs = document.querySelector('.login-mode-tabs');
    if (widget) widget.classList.toggle('logged', Boolean(agent));
    if (loggedCard) loggedCard.hidden = !agent || passwordRecoveryMode;
    if (tabs) tabs.hidden = Boolean(agent) || passwordRecoveryMode;
    if (form && (agent || passwordRecoveryMode)) form.hidden = true;
    if (createForm && (agent || passwordRecoveryMode)) createForm.hidden = true;
    if (recoveryForm) recoveryForm.hidden = !passwordRecoveryMode;
    if (passwordRecoveryMode) document.getElementById('loginPanel')?.setAttribute('data-login-mode', 'recovery');
    if (!agent && form?.hidden && createForm?.hidden) setLoginMode('enter');
    if (name) name.textContent = agent ? agent.name : '—';
    if (tag) tag.textContent = agent ? `${agent.tag} · ${agent.level || 'LVL-02'} · ${agent.status || 'Autorizado'}` : '#-----';
    if (loginButtonText) loginButtonText.textContent = agent ? 'LOGADO' : 'FAZER LOGIN';
    renderUserProfile();
    if (!passwordRecoveryMode && !agent && !createForm?.hidden) setCreateLoginStatus('Preencha e-mail, nome, senha e telefone para criar o acesso.');
    if (!passwordRecoveryMode && !passwordRecoveryLinkError && !agent && !form?.hidden) setLoginStatus('Aguardando credenciais.');
  }

  function openLoginPanel() {
    const widget = document.getElementById('loginAccessWidget');
    const btn = document.getElementById('btnLoginAccess');
    const panel = document.getElementById('loginPanel');
    widget?.classList.add('open');
    btn?.setAttribute('aria-expanded', 'true');
    panel?.setAttribute('aria-hidden', 'false');
    if (!getLoggedAgent()) setLoginMode('enter');
  }

  function closeLoginPanel() {
    const widget = document.getElementById('loginAccessWidget');
    const btn = document.getElementById('btnLoginAccess');
    const panel = document.getElementById('loginPanel');
    widget?.classList.remove('open');
    btn?.setAttribute('aria-expanded', 'false');
    panel?.setAttribute('aria-hidden', 'true');
  }

  function toggleLoginPanel() {
    const widget = document.getElementById('loginAccessWidget');
    if (widget?.classList.contains('open')) closeLoginPanel();
    else openLoginPanel();
  }

  async function handleTagLoginSubmit(e) {
    e.preventDefault();
    const authStartedAt = Date.now();
    const emailInput = document.getElementById('loginTagInput');
    const passInput = document.getElementById('loginPasswordInput');
    const email = (emailInput?.value || '').trim().toLowerCase();

    if (!email || !emailInput?.checkValidity()) {
      setLoginStatus('INFORME UM E-MAIL VÁLIDO.', 'error');
      emailInput?.focus();
      return;
    }
    if (!(passInput?.value || '')) {
      setLoginStatus('INFORME SUA SENHA.', 'error');
      passInput?.focus();
      return;
    }

    try {
      if (!window.TriAxisAuth) throw new Error('Serviço de autenticação indisponível');
      setLoginStatus('VALIDANDO CONTA...', '');
      const state = await window.TriAxisAuth.signIn(email, passInput?.value || '');
      await waitForNeutralAuthTiming(authStartedAt);
      const agent = mapRemoteProfileToAgent(state.profile);
      setLoginStatus('CONTA VERIFICADA · ACESSO LIBERADO.', 'ok');
      if (emailInput) emailInput.value = email;
      if (passInput) passInput.value = '';
      showToast(`LOGIN REALIZADO · ${agent?.tag || 'TRIAXIS'}`);
      closeLoginPanel();
      switchView('profile');
    } catch (err) {
      await waitForNeutralAuthTiming(authStartedAt);
      console.error('Falha ao validar acesso.');
      const friendly = 'NÃO FOI POSSÍVEL ENTRAR. CONFIRA AS CREDENCIAIS E A CONFIRMAÇÃO DO E-MAIL.';
      setLoginStatus(friendly, 'error');
      showToast(friendly, 'error');
      passInput?.focus();
    }
  }

  async function logoutAccess() {
    try {
      await window.TriAxisAuth?.signOut();
      showToast('LOGIN ENCERRADO');
    } catch (err) {
      console.error('Falha ao encerrar sessão:', err);
      showToast('NÃO FOI POSSÍVEL ENCERRAR A SESSÃO', 'error');
    } finally {
      clearRuntimeLocalPii();
      window.TriAxisOrders?.clearAllIntents?.();
      physicalRequests = [];
      agents = [];
      remoteAuthState = { session: null, profile: null, roles: [] };
      renderLoginState();
      renderAllDynamic();
    }
  }



  function openCatalogDetail(productId) {
    const product = enrichCatalogProduct(getCatalogProduct(productId));
    const content = document.getElementById('catalogDetailContent');
    if (!content) return;
    const gallery = product.gallery.map((src, index) => `<figure class="catalog-detail-thumb ${index === 0 ? 'active' : ''}"><img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}"></figure>`).join('');
    content.innerHTML = `
      <div class="catalog-detail-grid catalog-detail-grid--premium">
        <div class="catalog-detail-gallery catalog-detail-gallery--premium">${gallery}</div>
        <div class="catalog-detail-info">
          <p class="eyebrow">// ${escapeHtml(product.lineLabel)} · ${escapeHtml(product.type)}</p>
          <h2 id="catalogDetailTitle">${escapeHtml(product.name)}</h2>
          <div class="catalog-detail-badges"><span>${escapeHtml(product.availabilityLabel)}</span><span>${formatCurrencyBRL(product.basePrice)}</span><span>${escapeHtml(product.productionTime)}</span></div>
          <p>${escapeHtml(product.description)}</p>
          <div class="catalog-detail-table catalog-detail-table--premium">
            <p><b>Origem</b><span>Catálogo TriAxis</span></p>
            <p><b>Prazo</b><span>${escapeHtml(product.productionTime)}</span></p>
            <p><b>Tamanho</b><span>${escapeHtml(product.size)}</span></p>
            <p><b>Personalização</b><span>${escapeHtml(product.customization)}</span></p>
            <p><b>Materiais</b><span>${escapeHtml(product.materials.join(' · '))}</span></p>
            <p><b>Uso recomendado</b><span>${escapeHtml(product.uses.join(' · '))}</span></p>
          </div>
          <div class="catalog-specs catalog-specs--detail">${product.specs.map(spec => `<span>${escapeHtml(spec)}</span>`).join('')}<span>ARTEFATO FÍSICO</span></div>
          <div class="catalog-detail-note">VALIDAÇÃO NECESSÁRIA · uma tag autorizada deve estar vinculada antes da solicitação.</div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline" data-close-modal="modalCatalogDetail">FECHAR</button>
            <button type="button" class="btn btn-primary" data-catalog-config="${escapeHtml(product.id)}">CONFIGURAR ESTE ARTEFATO</button>
          </div>
        </div>
      </div>`;
    content.querySelector('[data-catalog-config]')?.addEventListener('click', () => { closeModal('modalCatalogDetail'); openCatalogConfigurator(product.id); });
    content.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal'))));
    openModal('modalCatalogDetail');
    updatePurchaseGateUi();
  }

  function openCatalogConfigurator(productId) {
    const validatedAgent = requirePurchaseValidation();
    if (!validatedAgent) return;
    const product = enrichCatalogProduct(getCatalogProduct(productId));
    currentPhysicalProduct = product.id;
    currentPhysicalVariant = currentPhysicalVariant || 'standard';
    const content = document.getElementById('catalogConfigContent');
    if (!content) return;
    content.innerHTML = `
      <div class="catalog-config-grid catalog-config-grid--stepped">
        <aside class="catalog-config-preview catalog-config-preview--sticky">
          <img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.name)}">
          <div class="catalog-config-preview-tag"><span>${escapeHtml(product.lineLabel)}</span><strong>${escapeHtml(product.name)}</strong></div>
          <div class="catalog-config-summary catalog-config-summary--fixed" id="catalogConfigSummary"></div>
        </aside>
        <form id="catalogConfigForm" class="catalog-config-form catalog-config-form--steps">
          <div class="catalog-step"><span>01</span><b>Produto</b><small>${escapeHtml(product.name)} · ${escapeHtml(product.type)}</small></div>
          <div class="form-tag-preview"><span class="form-tag-label">AGENTE VINCULADO</span><span class="form-tag-value">${escapeHtml(validatedAgent.name)} · ${escapeHtml(validatedAgent.tag)}</span></div>
          <input id="catalogConfigAgent" type="hidden" value="${escapeHtml(validatedAgent.tag)}">
          <div class="catalog-step"><span>02</span><b>Personalização</b><small>Versão, quantidade e cores do artefato.</small></div>
          <div class="form-row">
            <div class="form-field"><label for="catalogConfigVariant">VERSÃO</label><select id="catalogConfigVariant">${Object.entries(PHYSICAL_VARIANTS).map(([key, item]) => `<option value="${escapeHtml(key)}">${escapeHtml(item.label)} · +${formatCurrencyBRL(item.price)}</option>`).join('')}</select></div>
            <div class="form-field"><label for="catalogConfigQty">QUANTIDADE</label><input id="catalogConfigQty" type="number" min="1" max="99" value="1"></div>
          </div>
          <div class="form-row">
            <div class="form-field"><label for="catalogConfigColorMain">COR PRINCIPAL</label><input id="catalogConfigColorMain" type="text" value="Preto fosco"></div>
            <div class="form-field"><label for="catalogConfigColorAccent">COR DE DETALHE</label><input id="catalogConfigColorAccent" type="text" value="Vermelho TriAxis"></div>
          </div>
          <div class="catalog-step"><span>03</span><b>Material e acabamento</b><small>Base física para fabricação e entrega.</small></div>
          <div class="form-row">
            <div class="form-field"><label for="catalogConfigMaterial">MATERIAL</label><select id="catalogConfigMaterial">${Object.entries(PHYSICAL_ORDER_OPTIONS.material).map(([key, item]) => `<option value="${escapeHtml(key)}">${escapeHtml(item.label)} · ${getMaterialSurcharge(key) ? '+' + formatCurrencyBRL(getMaterialSurcharge(key)) : 'incluso no preço base'}</option>`).join('')}</select></div>
            <div class="form-field"><label for="catalogConfigFinish">ACABAMENTO</label><select id="catalogConfigFinish">${Object.entries(PHYSICAL_ORDER_OPTIONS.finish).map(([key, item]) => `<option value="${escapeHtml(key)}">${escapeHtml(item.label)} · +${formatCurrencyBRL(item.price)}</option>`).join('')}</select></div>
          </div>
          <div class="form-row">
            <div class="form-field"><label for="catalogConfigAccessory">ACESSÓRIO</label><select id="catalogConfigAccessory">${Object.entries(PHYSICAL_ORDER_OPTIONS.accessory).map(([key, item]) => `<option value="${escapeHtml(key)}">${escapeHtml(item.label)} · +${formatCurrencyBRL(item.price)}</option>`).join('')}</select></div>
            <div class="form-field"><label>PRAZO ESTIMADO</label><input type="text" value="${escapeHtml(product.productionTime)}" readonly></div>
          </div>
          <div class="catalog-step"><span>04</span><b>Resumo</b><small>Revise e envie para produção.</small></div>
          <div class="form-field"><label for="catalogConfigNotes">OBSERVAÇÃO DO ARTEFATO</label><textarea id="catalogConfigNotes" placeholder="Ex: nome exibido, cor da argola, prazo, referência visual..."></textarea></div>
          <div class="catalog-config-review" id="catalogConfigReview"></div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline" data-close-modal="modalCatalogConfig">CANCELAR</button>
            <button type="submit" class="btn btn-primary">CONFIRMAR SOLICITAÇÃO</button>
          </div>
        </form>
      </div>`;
    const form = document.getElementById('catalogConfigForm');
    ['catalogConfigAgent','catalogConfigVariant','catalogConfigMaterial','catalogConfigFinish','catalogConfigAccessory','catalogConfigQty','catalogConfigColorMain','catalogConfigColorAccent','catalogConfigNotes'].forEach(id => document.getElementById(id)?.addEventListener('input', () => updateCatalogConfigSummary(product)));
    form?.addEventListener('submit', (e) => { e.preventDefault(); submitCatalogConfiguredOrder(product); });
    content.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal'))));
    updateCatalogConfigSummary(product);
    openModal('modalCatalogConfig');
  }

  function getCatalogConfigData(product) {
    const agentTag = document.getElementById('catalogConfigAgent')?.value || validatedPurchaseTag || '';
    const agent = agentTag ? findAgentByTag(agentTag) : null;
    const variant = document.getElementById('catalogConfigVariant')?.value || 'standard';
    const material = document.getElementById('catalogConfigMaterial')?.value || 'pla_fosco';
    const finish = document.getElementById('catalogConfigFinish')?.value || 'simples';
    const accessory = document.getElementById('catalogConfigAccessory')?.value || 'ball_chain';
    const quantityInput = document.getElementById('catalogConfigQty');
    const quantityValue = Number(quantityInput?.value);
    const quantityValid = Number.isInteger(quantityValue) && quantityValue >= 1 && quantityValue <= 99;
    const qty = quantityValid ? quantityValue : 0;
    const colorMain = document.getElementById('catalogConfigColorMain')?.value.trim() || 'Preto fosco';
    const colorAccent = document.getElementById('catalogConfigColorAccent')?.value.trim() || 'Vermelho TriAxis';
    const notes = (document.getElementById('catalogConfigNotes')?.value.trim() || '').slice(0, 1000);
    const unitPrice = estimatePhysicalPrice(material, finish, accessory, product.id, variant);
    const estimatedPrice = Math.round(unitPrice * qty * 100) / 100;
    return { agentTag, agent, variant, material, finish, accessory, qty, quantityValid, colorMain, colorAccent, notes, unitPrice, estimatedPrice };
  }

  function updateCatalogConfigSummary(product) {
    const box = document.getElementById('catalogConfigSummary');
    const review = document.getElementById('catalogConfigReview');
    const data = getCatalogConfigData(product);
    const agentLabel = data.agent ? `${data.agent.name} ${data.agent.tag}` : 'sem agente vinculado';
    const summaryHtml = `
      <span>PREÇO ESTIMADO</span>
      <strong>${data.quantityValid ? formatCurrencyBRL(data.estimatedPrice) : 'QUANTIDADE INVÁLIDA'}</strong>
      <small>${escapeHtml(product.name)} · ${escapeHtml(getVariantLabel(data.variant))}</small>
      <small>${escapeHtml(getPhysicalOptionLabel('material', data.material))} · ${escapeHtml(getPhysicalOptionLabel('finish', data.finish))} · ${data.qty} unidade${data.qty > 1 ? 's' : ''}</small>
      <small>Agente vinculado: ${escapeHtml(agentLabel)}</small>`;
    if (box) box.innerHTML = summaryHtml;
    if (review) review.innerHTML = `
      <p><b>Artefato</b><span>${escapeHtml(product.name)}</span></p>
      <p><b>Agente</b><span>${escapeHtml(agentLabel)}</span></p>
      <p><b>Versão</b><span>${escapeHtml(getVariantLabel(data.variant))}</span></p>
      <p><b>Material</b><span>${escapeHtml(getPhysicalOptionLabel('material', data.material))}</span></p>
      <p><b>Acabamento</b><span>${escapeHtml(getPhysicalOptionLabel('finish', data.finish))}</span></p>
      <p><b>Acessório</b><span>${escapeHtml(getPhysicalOptionLabel('accessory', data.accessory))}</span></p>
      <p><b>Cores</b><span>${escapeHtml(data.colorMain)} / ${escapeHtml(data.colorAccent)}</span></p>
      <p><b>Total</b><span>${formatCurrencyBRL(data.estimatedPrice)}</span></p>`;
  }

  async function submitCatalogConfiguredOrder(product) {
    if (orderSubmissionPending) return;
    const validatedAgent = requirePurchaseValidation();
    if (!validatedAgent) return;
    const data = getCatalogConfigData(product);
    if (!data.quantityValid) {
      showToast('INFORME UMA QUANTIDADE INTEIRA ENTRE 1 E 99', 'error');
      document.getElementById('catalogConfigQty')?.focus();
      return;
    }
    if (!data.agent || data.agent.tag !== validatedAgent.tag) {
      showToast('TAG VALIDADA NÃO CONFERE COM O PEDIDO', 'error');
      return;
    }
    if (!product.remoteId || !window.TriAxisOrders) {
      showToast('PRODUTO ONLINE INDISPONÍVEL. ATUALIZE O CATÁLOGO.', 'error');
      return;
    }
    orderSubmissionPending = true;
    try {
      catalogOrderIntentId = `catalog:${data.agent.id || data.agent.tag}:${product.remoteId}`;
      const result = await window.TriAxisOrders.submit({
        productId: product.remoteId,
        quantity: data.qty,
        intentId: catalogOrderIntentId,
        notes: data.notes,
        configuration: {
          variant: data.variant,
          material: data.material,
          finish: data.finish,
          accessory: data.accessory,
          color_main: data.colorMain.slice(0, 120),
          color_accent: data.colorAccent.slice(0, 120),
          origin: 'catalogo',
          deadline: String(product.productionTime || 'sob_consulta').slice(0, 120)
        }
      });
      closeModal('modalCatalogConfig');
      await refreshOrdersFromSupabase();
      renderCatalog();
      showToast(`PEDIDO ${result?.order_code || ''} REGISTRADO · AGUARDANDO COMPROVAÇÃO`);
      switchView('profile');
    } catch (error) {
      console.error('Falha ao enviar pedido do catálogo:', error);
      showToast('NÃO FOI POSSÍVEL ENVIAR O PEDIDO. TENTE NOVAMENTE.', 'error');
    } finally {
      orderSubmissionPending = false;
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════
     CATALOG ADMIN V4 — edição completa, prioridade e formatação da vitrine
  ═══════════════════════════════════════════════════════════════════════ */
  const CATALOG_ADMIN_STORAGE_KEY = 'triaxis_catalog_admin_v4';
  const DEFAULT_CATALOG_LAYOUT = {
    title: 'CATÁLOGO TRIAXIS',
    subtitle: 'Terminal de solicitação de artefatos físicos TriAxis, com filtros, detalhes, configurador e envio para produção.',
    columns: 'auto',
    density: 'detailed',
    imageRatio: 'wide',
    alignment: 'left',
    gap: 'normal',
    sort: 'manual',
    showFeatured: true,
    showData: true,
    showSpecs: true,
    showRequirement: true,
    showAvailability: true,
    featuredKicker: '// ARTEFATO EM DESTAQUE',
    featuredNote: ''
  };

  let catalogLayout = { ...DEFAULT_CATALOG_LAYOUT };
  let catalogAdminEditingId = null;
  let catalogAdminGalleryDraft = [];
  let catalogAdminMainImageDraft = '';
  let catalogAdminDragId = null;
  let catalogRemoteRefreshSequence = 0;
  let catalogRemoteMutationPending = false;
  let catalogRemoteSeedPromise = null;

  function toStringList(value, fallback = []) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/\n|,/).map(item => item.trim()).filter(Boolean);
    return fallback.slice();
  }

  function safeCatalogColor(value) {
    const color = String(value || '').trim();
    return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(color) ? color : '#E8001C';
  }

  function finiteNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function safeCatalogAsset(value, fallback = 'assets/cybershape-unit.png') {
    const source = String(value || '').trim();
    if (!source || source.length > 2 * 1024 * 1024) return fallback;
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(source)) return source;
    if (/^assets\/[A-Za-z0-9._/-]+$/i.test(source)) return source;
    try {
      const url = new URL(source, window.location.href);
      if (url.protocol === 'https:' && url.hostname === 'fnmbdgvatcxvxebvsyga.supabase.co') return url.href;
    } catch (error) {}
    return fallback;
  }

  function slugifyCatalogId(value) {
    const normalized = String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42);
    return normalized || `produto_${Date.now().toString(36)}`;
  }

  function normalizeCatalogAdminRecord(record = {}, index = 0) {
    const id = slugifyCatalogId(record.id || record.name || `produto_${index + 1}`);
    const category = slugifyCatalogId(record.category || 'services');
    const img = safeCatalogAsset(record.img || record.gallery?.[0]);
    return {
      id,
      remoteId: record.remoteId || null,
      name: String(record.name || 'Novo artefato').trim() || 'Novo artefato',
      line: String(record.line || 'TRIAXIS PRODUCT').trim() || 'TRIAXIS PRODUCT',
      img,
      basePrice: finiteNumber(record.basePrice, 0, 0, 10000000),
      productionTime: String(record.productionTime || 'sob consulta').trim() || 'sob consulta',
      description: String(record.description || 'Artefato físico desenvolvido pelo laboratório TriAxis.').trim(),
      specs: toStringList(record.specs, ['Produção TriAxis']),
      category,
      categoryLabel: String(record.categoryLabel || (category === 'ids' ? 'IDs e Tags' : category === 'collectibles' ? 'Colecionáveis' : 'Serviços')).trim(),
      lineLabel: String(record.lineLabel || (category === 'ids' ? 'ACCESS TAGS' : category === 'collectibles' ? 'CHARACTER UNITS' : 'CUSTOM LAB')).trim(),
      type: String(record.type || record.line || 'ARTEFATO').trim(),
      availability: String(record.availability || 'custom_order').trim(),
      availabilityLabel: String(record.availabilityLabel || 'Sob encomenda').trim(),
      customization: String(record.customization || 'Personalização sob consulta').trim(),
      size: String(record.size || 'Sob consulta').trim(),
      materials: toStringList(record.materials, ['PLA', 'Resina']),
      uses: toStringList(record.uses, ['Produto personalizado']),
      gallery: Array.from(new Set(toStringList(record.gallery, [img]).map(source => safeCatalogAsset(source, img)).concat([img]))).filter(Boolean),
      hidden: Boolean(record.hidden),
      featured: Boolean(record.featured),
      priority: finiteNumber(record.priority, index, 0, 9999),
      promoLabel: String(record.promoLabel || '').trim(),
      ctaLabel: String(record.ctaLabel || 'SOLICITAR ARTEFATO').trim() || 'SOLICITAR ARTEFATO',
      cardStyle: ['standard', 'technical', 'spotlight', 'minimal'].includes(record.cardStyle) ? record.cardStyle : 'standard',
      accent: safeCatalogColor(record.accent || '#E8001C'),
      imageFit: ['cover', 'contain'].includes(record.imageFit) ? record.imageFit : 'contain',
      showPrice: record.showPrice !== false,
      updatedAt: record.updatedAt || new Date().toISOString()
    };
  }

  const DEFAULT_CATALOG_SNAPSHOT = {
    products: CATALOG_PRODUCTS.map((product, index) => normalizeCatalogAdminRecord({
      ...product,
      ...(CATALOG_META[product.id] || {}),
      priority: index,
      featured: index === 0,
      promoLabel: index === 0 ? 'ARTEFATO EM DESTAQUE' : '',
      cardStyle: index === 0 ? 'spotlight' : 'standard'
    }, index)),
    layout: { ...DEFAULT_CATALOG_LAYOUT }
  };

  function normalizeCatalogLayout(layout = {}) {
    return {
      ...DEFAULT_CATALOG_LAYOUT,
      ...layout,
      columns: ['auto', '2', '3', '4'].includes(String(layout.columns)) ? String(layout.columns) : 'auto',
      density: ['detailed', 'compact', 'minimal'].includes(layout.density) ? layout.density : 'detailed',
      imageRatio: ['wide', 'square', 'portrait'].includes(layout.imageRatio) ? layout.imageRatio : 'wide',
      alignment: ['left', 'center'].includes(layout.alignment) ? layout.alignment : 'left',
      gap: ['tight', 'normal', 'wide'].includes(layout.gap) ? layout.gap : 'normal',
      sort: ['manual', 'name', 'price_asc', 'price_desc'].includes(layout.sort) ? layout.sort : 'manual',
      showFeatured: layout.showFeatured !== false,
      showData: layout.showData !== false,
      showSpecs: layout.showSpecs !== false,
      showRequirement: layout.showRequirement !== false,
      showAvailability: layout.showAvailability !== false
    };
  }

  function getCatalogAdminRecords() {
    return CATALOG_PRODUCTS.map((product, index) => normalizeCatalogAdminRecord({
      ...product,
      ...(CATALOG_META[product.id] || {}),
      priority: product.priority ?? index
    }, index));
  }

  function applyCatalogAdminRecords(records) {
    const normalized = records.map(normalizeCatalogAdminRecord);
    if (normalized.length && !normalized.some(item => item.featured && !item.hidden)) {
      const firstVisible = normalized.find(item => !item.hidden);
      if (firstVisible) firstVisible.featured = true;
    }
    CATALOG_PRODUCTS.splice(0, CATALOG_PRODUCTS.length, ...normalized.map(record => ({
      id: record.id,
      name: record.name,
      line: record.line,
      img: record.img,
      basePrice: record.basePrice,
      productionTime: record.productionTime,
      description: record.description,
      specs: record.specs,
      hidden: record.hidden,
      featured: record.featured,
      priority: record.priority,
      promoLabel: record.promoLabel,
      ctaLabel: record.ctaLabel,
      cardStyle: record.cardStyle,
      accent: record.accent,
      imageFit: record.imageFit,
      showPrice: record.showPrice,
      updatedAt: record.updatedAt
    })));
    Object.keys(CATALOG_META).forEach(key => delete CATALOG_META[key]);
    normalized.forEach(record => {
      CATALOG_META[record.id] = {
        category: record.category,
        categoryLabel: record.categoryLabel,
        lineLabel: record.lineLabel,
        type: record.type,
        availability: record.availability,
        availabilityLabel: record.availabilityLabel,
        customization: record.customization,
        size: record.size,
        materials: record.materials,
        uses: record.uses,
        gallery: record.gallery
      };
    });
    const validIds = new Set(CATALOG_PRODUCTS.map(product => product.id));
    if (!validIds.has(currentPhysicalProduct)) currentPhysicalProduct = CATALOG_PRODUCTS[0]?.id || 'vector_sigil';
  }

  function getCatalogAdminState() {
    return {
      version: 4,
      savedAt: new Date().toISOString(),
      products: getCatalogAdminRecords(),
      layout: normalizeCatalogLayout(catalogLayout)
    };
  }

  function loadCatalogAdminState() {
    try {
      const raw = localStorage.getItem(CATALOG_ADMIN_STORAGE_KEY);
      if (!raw) {
        applyCatalogAdminRecords(JSON.parse(JSON.stringify(DEFAULT_CATALOG_SNAPSHOT.products)));
        catalogLayout = normalizeCatalogLayout(DEFAULT_CATALOG_SNAPSHOT.layout);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.products)) throw new Error('Catálogo inválido');
      applyCatalogAdminRecords(parsed.products);
      catalogLayout = normalizeCatalogLayout(parsed.layout || {});
    } catch (error) {
      console.error('Falha ao carregar catálogo administrativo:', error);
      applyCatalogAdminRecords(JSON.parse(JSON.stringify(DEFAULT_CATALOG_SNAPSHOT.products)));
      catalogLayout = normalizeCatalogLayout(DEFAULT_CATALOG_SNAPSHOT.layout);
    }
  }

  function persistCatalogLocalState() {
    localStorage.setItem(CATALOG_ADMIN_STORAGE_KEY, JSON.stringify(getCatalogAdminState()));
  }

  async function refreshCatalogFromSupabase() {
    if (!window.TriAxisCatalog) return false;
    const sequence = ++catalogRemoteRefreshSequence;
    try {
      const remote = await window.TriAxisCatalog.load();
      if (sequence !== catalogRemoteRefreshSequence) return false;
      if (!remote.products.length) {
        if (!window.TriAxisAuth?.isAdmin?.()) return false;
        if (!catalogRemoteSeedPromise) {
          catalogRemoteSeedPromise = window.TriAxisCatalog.sync(getCatalogAdminState())
            .finally(() => { catalogRemoteSeedPromise = null; });
        }
        const seeded = await catalogRemoteSeedPromise;
        if (sequence !== catalogRemoteRefreshSequence) return false;
        applyCatalogAdminRecords(seeded.products);
        catalogLayout = normalizeCatalogLayout(seeded.layout || catalogLayout);
        persistCatalogLocalState();
        renderAllDynamic();
        renderCatalogAdmin();
        scheduleCatalogSignedUrlRefresh();
        showToast('CATÁLOGO INICIAL MIGRADO PARA O SUPABASE');
        return true;
      }
      applyCatalogAdminRecords(remote.products);
      catalogLayout = normalizeCatalogLayout(remote.layout || catalogLayout);
      persistCatalogLocalState();
      renderAllDynamic();
      renderCatalogAdmin();
      scheduleCatalogSignedUrlRefresh();
      return true;
    } catch (error) {
      console.error('Falha ao carregar catálogo do Supabase; usando cópia local:', error);
      if (window.TriAxisAuth?.isAdmin?.()) showToast('CATÁLOGO ONLINE INDISPONÍVEL · VERIFIQUE A MIGRAÇÃO 002', 'error');
      return false;
    }
  }

  function scheduleCatalogSignedUrlRefresh() {
    if (catalogSignedRefreshTimer) clearTimeout(catalogSignedRefreshTimer);
    const delay = Number(window.TriAxisCatalog?.signedUrlRefreshMs || 45 * 60 * 1000);
    catalogSignedRefreshTimer = setTimeout(() => { void refreshCatalogFromSupabase(); }, delay);
  }

  async function saveCatalogAdminState(options = {}) {
    if (!requireAdminMode()) {
      loadCatalogAdminState();
      return false;
    }
    try {
      persistCatalogLocalState();
    } catch (error) {
      console.error('Falha ao salvar catálogo:', error);
      showToast('ARMAZENAMENTO CHEIO · REDUZA O TAMANHO DAS IMAGENS DO CATÁLOGO', 'error');
      return false;
    }
    try {
      if (!window.TriAxisCatalog) throw new Error('CATALOG_SERVICE_MISSING');
      const synced = await window.TriAxisCatalog.sync(getCatalogAdminState());
      applyCatalogAdminRecords(synced.products);
      catalogLayout = normalizeCatalogLayout(synced.layout || catalogLayout);
      persistCatalogLocalState();
    } catch (error) {
      console.error('Falha ao sincronizar catálogo no Supabase:', error);
      showToast('NÃO FOI POSSÍVEL SALVAR O CATÁLOGO ONLINE', 'error');
      return false;
    }
    if (options.log !== false) addLog(options.message || 'CATÁLOGO ADMINISTRATIVO ATUALIZADO');
    if (options.render !== false) {
      renderCatalog();
      renderCatalogAdmin();
      renderLabGallery();
      renderPhysicalIdView();
    }
    return true;
  }

  function snapshotCatalogState() {
    return JSON.parse(JSON.stringify(getCatalogAdminState()));
  }

  function restoreCatalogState(snapshot) {
    applyCatalogAdminRecords(snapshot.products);
    catalogLayout = normalizeCatalogLayout(snapshot.layout);
    renderCatalog();
    renderCatalogAdmin();
    renderLabGallery();
    renderPhysicalIdView();
  }

  async function commitCatalogMutation(snapshot, options) {
    if (catalogRemoteMutationPending) {
      restoreCatalogState(snapshot);
      showToast('AGUARDE A SINCRONIZAÇÃO DO CATÁLOGO', 'error');
      return false;
    }
    catalogRemoteMutationPending = true;
    try {
      if (await saveCatalogAdminState(options)) return true;
      restoreCatalogState(snapshot);
      try { persistCatalogLocalState(); } catch (error) { console.error('Falha ao restaurar cópia local do catálogo:', error); }
      return false;
    } finally {
      catalogRemoteMutationPending = false;
    }
  }

  function enrichCatalogProduct(product) {
    const meta = CATALOG_META[product.id] || {};
    const category = meta.category || 'services';
    return normalizeCatalogAdminRecord({
      ...product,
      ...meta,
      category,
      categoryLabel: meta.categoryLabel || 'Serviços',
      type: meta.type || product.line || 'ARTEFATO',
      availability: meta.availability || 'custom_order',
      availabilityLabel: meta.availabilityLabel || 'Sob encomenda',
      customization: meta.customization || 'Personalização sob consulta',
      size: meta.size || 'Sob consulta',
      materials: meta.materials || ['PLA', 'Resina'],
      uses: meta.uses || ['Produto personalizado'],
      gallery: meta.gallery || [product.img]
    }, product.priority || 0);
  }

  function sortCatalogProducts(products) {
    const list = products.slice();
    if (catalogLayout.sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (catalogLayout.sort === 'price_asc') return list.sort((a, b) => a.basePrice - b.basePrice);
    if (catalogLayout.sort === 'price_desc') return list.sort((a, b) => b.basePrice - a.basePrice);
    return list.sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
  }

  function getCatalogProductsFiltered() {
    const search = (document.getElementById('catalogSearchInput')?.value || '').trim().toUpperCase();
    const category = document.getElementById('catalogCategoryFilter')?.value || 'all';
    const price = document.getElementById('catalogPriceFilter')?.value || 'all';
    const time = document.getElementById('catalogTimeFilter')?.value || 'all';
    const availability = document.getElementById('catalogAvailabilityFilter')?.value || 'all';
    const products = getCatalogAdminRecords().filter(product => !product.hidden).filter(product => {
      const hay = `${product.name} ${product.line} ${product.description} ${product.categoryLabel} ${product.type} ${product.customization} ${product.uses.join(' ')} ${product.specs.join(' ')}`.toUpperCase();
      const searchOk = !search || hay.includes(search);
      const categoryOk = category === 'all' || product.category === category;
      const availabilityOk = availability === 'all' || product.availability === availability;
      const priceOk = price === 'all' ||
        (price === 'low' && product.basePrice <= 25) ||
        (price === 'mid' && product.basePrice > 25 && product.basePrice <= 40) ||
        (price === 'high' && product.basePrice > 40);
      const prodTime = String(product.productionTime || '').toLowerCase();
      const timeOk = time === 'all' ||
        (time === 'fast' && (prodTime.includes('1 dia') || prodTime.includes('24h'))) ||
        (time === 'standard' && !prodTime.includes('sob consulta')) ||
        (time === 'custom' && prodTime.includes('sob consulta'));
      return searchOk && categoryOk && availabilityOk && priceOk && timeOk;
    });
    return sortCatalogProducts(products);
  }

  function getCatalogCategoryMap() {
    const map = new Map();
    getCatalogAdminRecords().filter(product => !product.hidden).forEach(product => {
      if (!map.has(product.category)) map.set(product.category, product.categoryLabel || product.category);
    });
    return map;
  }

  function syncCatalogCategoryFilter() {
    const select = document.getElementById('catalogCategoryFilter');
    if (!select) return;
    const previous = select.value || 'all';
    const map = getCatalogCategoryMap();
    select.innerHTML = '<option value="all">Todas as categorias</option>' + Array.from(map.entries()).map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('');
    select.value = map.has(previous) || previous === 'all' ? previous : 'all';
  }

  function renderCatalogCategoryStrip() {
    const strip = document.getElementById('catalogCategoryStrip');
    if (!strip) return;
    const current = document.getElementById('catalogCategoryFilter')?.value || 'all';
    const visible = getCatalogAdminRecords().filter(product => !product.hidden);
    const categories = [['all', 'Todos'], ...Array.from(getCatalogCategoryMap().entries())];
    strip.innerHTML = categories.map(([key, label]) => {
      const count = key === 'all' ? visible.length : visible.filter(product => product.category === key).length;
      return `<button class="catalog-chip ${current === key ? 'active' : ''}" data-catalog-category="${escapeHtml(key)}" type="button"><span>${escapeHtml(label)}</span><b>${count}</b></button>`;
    }).join('');
    strip.querySelectorAll('[data-catalog-category]').forEach(button => button.addEventListener('click', () => {
      const select = document.getElementById('catalogCategoryFilter');
      if (select) select.value = button.getAttribute('data-catalog-category');
      renderCatalog();
    }));
  }

  function applyCatalogLayout() {
    const view = document.getElementById('view-catalog');
    const grid = document.getElementById('catalogGrid');
    if (!view || !grid) return;
    view.dataset.catalogDensity = catalogLayout.density;
    view.dataset.catalogImageRatio = catalogLayout.imageRatio;
    view.dataset.catalogAlignment = catalogLayout.alignment;
    view.dataset.catalogGap = catalogLayout.gap;
    view.dataset.showData = String(catalogLayout.showData);
    view.dataset.showSpecs = String(catalogLayout.showSpecs);
    view.dataset.showRequirement = String(catalogLayout.showRequirement);
    view.dataset.showAvailability = String(catalogLayout.showAvailability);
    grid.style.setProperty('--catalog-columns', catalogLayout.columns === 'auto' ? 'repeat(auto-fit, minmax(250px, 1fr))' : `repeat(${catalogLayout.columns}, minmax(0, 1fr))`);
    const headerTitle = view.querySelector('.catalog-header-v2 h1');
    const headerSub = view.querySelector('.catalog-header-v2 .view-sub');
    if (headerTitle) {
      headerTitle.textContent = catalogLayout.title || DEFAULT_CATALOG_LAYOUT.title;
      headerTitle.setAttribute('data-text', catalogLayout.title || DEFAULT_CATALOG_LAYOUT.title);
    }
    if (headerSub) headerSub.textContent = catalogLayout.subtitle || DEFAULT_CATALOG_LAYOUT.subtitle;
  }

  function getFeaturedCatalogProduct() {
    const visible = sortCatalogProducts(getCatalogAdminRecords().filter(product => !product.hidden));
    return visible.find(product => product.featured) || visible[0] || null;
  }

  function renderCatalogFeatured() {
    const container = document.getElementById('catalogFeatured');
    if (!container) return;
    const product = getFeaturedCatalogProduct();
    container.hidden = !catalogLayout.showFeatured || !product;
    if (!product || container.hidden) return;
    const note = catalogLayout.featuredNote || product.description;
    container.style.setProperty('--catalog-product-accent', safeCatalogColor(product.accent));
    container.innerHTML = `
      <span class="hud-corner tl"></span><span class="hud-corner tr"></span><span class="hud-corner bl"></span><span class="hud-corner br"></span>
      <div class="catalog-featured-copy">
        <p class="eyebrow">${escapeHtml(catalogLayout.featuredKicker || DEFAULT_CATALOG_LAYOUT.featuredKicker)}</p>
        <h2>${escapeHtml(product.name)} // ${escapeHtml(product.lineLabel)}</h2>
        <p>${escapeHtml(note)}</p>
        <div class="catalog-featured-meta">
          <span><b>PREÇO BASE</b>${product.showPrice ? formatCurrencyBRL(product.basePrice) : 'SOB CONSULTA'}</span>
          <span><b>PRAZO</b>${escapeHtml(product.productionTime)}</span>
          <span><b>LINHA</b>${escapeHtml(product.lineLabel)}</span>
        </div>
        <div class="catalog-featured-actions">
          <button class="btn btn-primary" data-catalog-config="${escapeHtml(product.id)}" type="button">${escapeHtml(product.ctaLabel || 'VALIDAR TAG E SOLICITAR')}</button>
          <button class="btn btn-outline" data-catalog-detail="${escapeHtml(product.id)}" type="button">VER DETALHES</button>
        </div>
      </div>
      <div class="catalog-featured-art">
        <img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.name)} TriAxis" style="object-fit:${escapeHtml(product.imageFit)}">
        <span>${escapeHtml(product.promoLabel || product.line)} · ${escapeHtml(product.availabilityLabel)} · TRIAXIS NODE</span>
      </div>`;
    container.querySelector('[data-catalog-detail]')?.addEventListener('click', () => openCatalogDetail(product.id));
    container.querySelector('[data-catalog-config]')?.addEventListener('click', () => openCatalogConfigurator(product.id));
  }

  function renderCatalog() {
    const grid = document.getElementById('catalogGrid');
    if (!grid) return;
    syncCatalogCategoryFilter();
    applyCatalogLayout();
    renderCatalogFeatured();
    const products = getCatalogProductsFiltered();
    renderCatalogCategoryStrip();
    const count = document.getElementById('catalogResultCount');
    if (count) count.textContent = `${products.length} artefato${products.length !== 1 ? 's' : ''} encontrado${products.length !== 1 ? 's' : ''} · ${getCatalogAdminRecords().filter(item => !item.hidden).length} publicado${getCatalogAdminRecords().filter(item => !item.hidden).length !== 1 ? 's' : ''}`;
    if (!products.length) {
      grid.innerHTML = '<div class="empty-state visible catalog-empty"><div class="empty-icon">▢</div><p>NENHUM ARTEFATO ENCONTRADO</p><small>Ajuste os filtros ou publique um produto no painel administrativo.</small></div>';
      renderCatalogAdmin();
      return;
    }
    grid.innerHTML = products.map((product, index) => `
      <article class="catalog-card catalog-card-v2 catalog-card-polished catalog-card-style--${escapeHtml(product.cardStyle)} hud-frame ${product.featured ? 'is-featured' : ''}" data-product-id="${escapeHtml(product.id)}" style="--catalog-product-accent:${escapeHtml(safeCatalogColor(product.accent))};--catalog-priority:${index + 1}">
        <span class="hud-corner tl"></span><span class="hud-corner br"></span>
        ${product.featured ? '<span class="catalog-feature-ribbon">DESTAQUE</span>' : ''}
        ${product.promoLabel ? `<span class="catalog-promo-label">${escapeHtml(product.promoLabel)}</span>` : ''}
        <div class="catalog-card-img catalog-card-img-v2"><img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.name)}" style="object-fit:${escapeHtml(product.imageFit)}"><span class="catalog-card-requirement">REQUER TAG AUTORIZADA</span></div>
        <div class="catalog-card-body">
          <div class="catalog-card-topline"><span class="catalog-line">${escapeHtml(product.lineLabel)}</span><span class="catalog-status catalog-status--${escapeHtml(product.availability)}">${escapeHtml(product.availabilityLabel)}</span></div>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description)}</p>
          <div class="catalog-card-data catalog-card-data--polished">
            <span><b>Categoria</b>${escapeHtml(product.categoryLabel)}</span>
            <span><b>Tipo</b>${escapeHtml(product.type)}</span>
            <span><b>Personalização</b>${escapeHtml(product.customization)}</span>
            <span><b>Prazo</b>${escapeHtml(product.productionTime)}</span>
          </div>
          <div class="catalog-specs catalog-specs--chips">${product.specs.map(spec => `<span>${escapeHtml(spec)}</span>`).join('')}<span>3D PRINT</span><span>TRIAXIS LAB</span></div>
          <div class="catalog-meta catalog-meta-v2"><b>${product.showPrice ? formatCurrencyBRL(product.basePrice) : 'SOB CONSULTA'}</b><small>${product.showPrice ? 'preço base' : 'valor personalizado'} · ${escapeHtml(product.productionTime)}</small></div>
          <div class="catalog-actions catalog-actions-v2">
            <button class="btn btn-outline btn-sm" data-catalog-detail="${escapeHtml(product.id)}" type="button">VER DETALHES</button>
            <button class="btn btn-primary btn-sm" data-catalog-config="${escapeHtml(product.id)}" type="button">${escapeHtml(product.ctaLabel)}</button>
          </div>
        </div>
      </article>`).join('');
    grid.querySelectorAll('[data-catalog-detail]').forEach(button => button.addEventListener('click', () => openCatalogDetail(button.getAttribute('data-catalog-detail'))));
    grid.querySelectorAll('[data-catalog-config]').forEach(button => button.addEventListener('click', () => openCatalogConfigurator(button.getAttribute('data-catalog-config'))));
    grid.querySelectorAll('img[src*="/storage/v1/object/sign/product-images/"]').forEach((image) => {
      image.addEventListener('error', () => { void refreshCatalogFromSupabase(); }, { once: true });
    });
    updatePurchaseGateUi();
    renderCatalogAdmin();
  }

  function setCatalogPanel(panel = 'storefront') {
    const settings = loadSettings();
    const target = panel === 'admin' && hasRemoteRole('admin') && settings.mode === 'admin' ? 'admin' : 'storefront';
    const storefront = document.getElementById('catalogStorefrontPanel');
    const admin = document.getElementById('catalogAdminPanel');
    const storeButton = document.getElementById('btnCatalogStorefrontTab');
    const adminButton = document.getElementById('btnCatalogAdminTab');
    if (storefront) {
      storefront.hidden = target !== 'storefront';
      storefront.classList.toggle('active', target === 'storefront');
    }
    if (admin) {
      admin.hidden = target !== 'admin';
      admin.classList.toggle('active', target === 'admin');
    }
    storeButton?.classList.toggle('active', target === 'storefront');
    adminButton?.classList.toggle('active', target === 'admin');
    if (target === 'admin') renderCatalogAdmin();
    else renderCatalog();
  }

  function setCatalogLayoutFormValues() {
    const values = {
      catalogLayoutTitle: catalogLayout.title,
      catalogLayoutSubtitle: catalogLayout.subtitle,
      catalogLayoutColumns: catalogLayout.columns,
      catalogLayoutDensity: catalogLayout.density,
      catalogLayoutImageRatio: catalogLayout.imageRatio,
      catalogLayoutAlignment: catalogLayout.alignment,
      catalogLayoutGap: catalogLayout.gap,
      catalogLayoutSort: catalogLayout.sort,
      catalogFeaturedKicker: catalogLayout.featuredKicker,
      catalogFeaturedNote: catalogLayout.featuredNote
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element && document.activeElement !== element) element.value = value || '';
    });
    const checks = {
      catalogLayoutShowFeatured: catalogLayout.showFeatured,
      catalogLayoutShowData: catalogLayout.showData,
      catalogLayoutShowSpecs: catalogLayout.showSpecs,
      catalogLayoutShowRequirement: catalogLayout.showRequirement,
      catalogLayoutShowAvailability: catalogLayout.showAvailability
    };
    Object.entries(checks).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.checked = Boolean(value);
    });
  }

  function readCatalogLayoutForm() {
    return normalizeCatalogLayout({
      ...catalogLayout,
      title: document.getElementById('catalogLayoutTitle')?.value.trim() || DEFAULT_CATALOG_LAYOUT.title,
      subtitle: document.getElementById('catalogLayoutSubtitle')?.value.trim() || DEFAULT_CATALOG_LAYOUT.subtitle,
      columns: document.getElementById('catalogLayoutColumns')?.value || 'auto',
      density: document.getElementById('catalogLayoutDensity')?.value || 'detailed',
      imageRatio: document.getElementById('catalogLayoutImageRatio')?.value || 'wide',
      alignment: document.getElementById('catalogLayoutAlignment')?.value || 'left',
      gap: document.getElementById('catalogLayoutGap')?.value || 'normal',
      sort: document.getElementById('catalogLayoutSort')?.value || 'manual',
      showFeatured: Boolean(document.getElementById('catalogLayoutShowFeatured')?.checked),
      showData: Boolean(document.getElementById('catalogLayoutShowData')?.checked),
      showSpecs: Boolean(document.getElementById('catalogLayoutShowSpecs')?.checked),
      showRequirement: Boolean(document.getElementById('catalogLayoutShowRequirement')?.checked),
      showAvailability: Boolean(document.getElementById('catalogLayoutShowAvailability')?.checked),
      featuredKicker: document.getElementById('catalogFeaturedKicker')?.value.trim() || DEFAULT_CATALOG_LAYOUT.featuredKicker,
      featuredNote: document.getElementById('catalogFeaturedNote')?.value.trim() || ''
    });
  }

  async function saveCatalogLayoutFromPanel(message = 'FORMATAÇÃO DO CATÁLOGO ATUALIZADA') {
    const snapshot = snapshotCatalogState();
    catalogLayout = readCatalogLayoutForm();
    if (!await commitCatalogMutation(snapshot, { message })) return;
    showToast('FORMATAÇÃO DO CATÁLOGO SALVA');
  }

  function getCatalogAdminFilteredRecords() {
    const query = (document.getElementById('catalogAdminSearch')?.value || '').trim().toUpperCase();
    const status = document.getElementById('catalogAdminStatusFilter')?.value || 'all';
    return getCatalogAdminRecords().sort((a, b) => a.priority - b.priority).filter(product => {
      const queryOk = !query || `${product.name} ${product.id} ${product.line} ${product.categoryLabel}`.toUpperCase().includes(query);
      const statusOk = status === 'all' ||
        (status === 'published' && !product.hidden) ||
        (status === 'hidden' && product.hidden) ||
        (status === 'featured' && product.featured);
      return queryOk && statusOk;
    });
  }

  function renderCatalogAdminStats() {
    const container = document.getElementById('catalogAdminStats');
    if (!container) return;
    const records = getCatalogAdminRecords();
    const published = records.filter(product => !product.hidden).length;
    const hidden = records.filter(product => product.hidden).length;
    const featured = getFeaturedCatalogProduct();
    const average = records.length ? records.reduce((sum, product) => sum + product.basePrice, 0) / records.length : 0;
    container.innerHTML = `
      <div><span>PRODUTOS</span><strong>${records.length}</strong></div>
      <div><span>PUBLICADOS</span><strong>${published}</strong></div>
      <div><span>OCULTOS</span><strong>${hidden}</strong></div>
      <div><span>DESTAQUE</span><strong>${escapeHtml(featured?.name || '—')}</strong></div>
      <div><span>PREÇO MÉDIO</span><strong>${formatCurrencyBRL(average)}</strong></div>`;
  }

  function renderCatalogAdminFeaturedPreview() {
    const container = document.getElementById('catalogAdminFeaturedPreview');
    if (!container) return;
    const product = getFeaturedCatalogProduct();
    if (!product) {
      container.innerHTML = '<div class="catalog-admin-empty">NENHUM PRODUTO PUBLICADO</div>';
      return;
    }
    container.innerHTML = `<img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.name)}"><div><span>${escapeHtml(product.lineLabel)}</span><strong>${escapeHtml(product.name)}</strong><small>${product.showPrice ? formatCurrencyBRL(product.basePrice) : 'Sob consulta'} · ${escapeHtml(product.productionTime)}</small></div>`;
  }

  function renderCatalogAdminProductList() {
    const list = document.getElementById('catalogAdminProductList');
    if (!list) return;
    const products = getCatalogAdminFilteredRecords();
    if (!products.length) {
      list.innerHTML = '<div class="catalog-admin-empty">NENHUM PRODUTO CORRESPONDE AOS FILTROS</div>';
      return;
    }
    list.innerHTML = products.map((product, index) => `
      <article class="catalog-admin-product ${product.hidden ? 'is-hidden' : ''} ${product.featured ? 'is-featured' : ''}" draggable="true" data-admin-product="${escapeHtml(product.id)}">
        <button class="catalog-admin-drag" type="button" title="Arraste para mudar a prioridade">⠿</button>
        <div class="catalog-admin-thumb"><img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.name)}" style="object-fit:${escapeHtml(product.imageFit)}"></div>
        <div class="catalog-admin-product-copy">
          <div class="catalog-admin-product-title"><span>#${String(product.priority + 1).padStart(2, '0')}</span><h4>${escapeHtml(product.name)}</h4>${product.featured ? '<b>DESTAQUE</b>' : ''}${product.hidden ? '<b class="muted">OCULTO</b>' : ''}</div>
          <p>${escapeHtml(product.line)} · ${escapeHtml(product.categoryLabel)} · ${escapeHtml(product.availabilityLabel)}</p>
          <small>${product.showPrice ? formatCurrencyBRL(product.basePrice) : 'Sob consulta'} · ${escapeHtml(product.productionTime)} · atualizado ${formatDate(product.updatedAt)}</small>
        </div>
        <div class="catalog-admin-order-controls">
          <button type="button" data-catalog-move="up" data-id="${escapeHtml(product.id)}" title="Subir prioridade">▲</button>
          <button type="button" data-catalog-move="down" data-id="${escapeHtml(product.id)}" title="Descer prioridade">▼</button>
        </div>
        <div class="catalog-admin-product-actions">
          <button class="btn btn-outline btn-sm" type="button" data-catalog-feature="${escapeHtml(product.id)}">${product.featured ? 'EM DESTAQUE' : 'DESTACAR'}</button>
          <button class="btn btn-outline btn-sm" type="button" data-catalog-toggle="${escapeHtml(product.id)}">${product.hidden ? 'PUBLICAR' : 'OCULTAR'}</button>
          <button class="btn btn-primary btn-sm" type="button" data-catalog-edit="${escapeHtml(product.id)}">EDITAR</button>
          <button class="btn btn-outline btn-sm" type="button" data-catalog-duplicate="${escapeHtml(product.id)}">DUPLICAR</button>
          <button class="btn btn-danger btn-sm" type="button" data-catalog-delete="${escapeHtml(product.id)}">REMOVER</button>
        </div>
      </article>`).join('');

    list.querySelectorAll('[data-catalog-edit]').forEach(button => button.addEventListener('click', () => openCatalogAdminEditor(button.dataset.catalogEdit)));
    list.querySelectorAll('[data-catalog-duplicate]').forEach(button => button.addEventListener('click', () => duplicateCatalogProduct(button.dataset.catalogDuplicate)));
    list.querySelectorAll('[data-catalog-delete]').forEach(button => button.addEventListener('click', () => deleteCatalogProduct(button.dataset.catalogDelete)));
    list.querySelectorAll('[data-catalog-toggle]').forEach(button => button.addEventListener('click', () => toggleCatalogProductVisibility(button.dataset.catalogToggle)));
    list.querySelectorAll('[data-catalog-feature]').forEach(button => button.addEventListener('click', () => setFeaturedCatalogProduct(button.dataset.catalogFeature)));
    list.querySelectorAll('[data-catalog-move]').forEach(button => button.addEventListener('click', () => moveCatalogProduct(button.dataset.id, button.dataset.catalogMove)));
    list.querySelectorAll('[data-admin-product]').forEach(card => {
      card.addEventListener('dragstart', () => { catalogAdminDragId = card.dataset.adminProduct; card.classList.add('is-dragging'); });
      card.addEventListener('dragend', () => { catalogAdminDragId = null; card.classList.remove('is-dragging'); });
      card.addEventListener('dragover', event => { event.preventDefault(); card.classList.add('is-drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('is-drag-over'));
      card.addEventListener('drop', event => {
        event.preventDefault();
        card.classList.remove('is-drag-over');
        reorderCatalogProduct(catalogAdminDragId, card.dataset.adminProduct);
      });
    });
  }

  function renderCatalogAdmin() {
    if (!document.getElementById('catalogAdminPanel')) return;
    setCatalogLayoutFormValues();
    renderCatalogAdminStats();
    renderCatalogAdminFeaturedPreview();
    renderCatalogAdminProductList();
  }

  function renumberCatalogPriorities(records) {
    records.forEach((product, index) => { product.priority = index; });
    return records;
  }

  async function moveCatalogProduct(productId, direction) {
    const snapshot = snapshotCatalogState();
    const records = getCatalogAdminRecords().sort((a, b) => a.priority - b.priority);
    const index = records.findIndex(product => product.id === productId);
    if (index < 0) return;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= records.length) return;
    [records[index], records[target]] = [records[target], records[index]];
    applyCatalogAdminRecords(renumberCatalogPriorities(records));
    catalogLayout.sort = 'manual';
    await commitCatalogMutation(snapshot, { message: `PRIORIDADE ALTERADA · ${productId}` });
  }

  async function reorderCatalogProduct(sourceId, targetId) {
    const snapshot = snapshotCatalogState();
    if (!sourceId || !targetId || sourceId === targetId) return;
    const records = getCatalogAdminRecords().sort((a, b) => a.priority - b.priority);
    const sourceIndex = records.findIndex(product => product.id === sourceId);
    const targetIndex = records.findIndex(product => product.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = records.splice(sourceIndex, 1);
    records.splice(targetIndex, 0, moved);
    applyCatalogAdminRecords(renumberCatalogPriorities(records));
    catalogLayout.sort = 'manual';
    await commitCatalogMutation(snapshot, { message: `ORDEM DO CATÁLOGO ALTERADA · ${moved.name}` });
  }

  async function setFeaturedCatalogProduct(productId) {
    const snapshot = snapshotCatalogState();
    const records = getCatalogAdminRecords();
    records.forEach(product => { product.featured = product.id === productId; });
    const selected = records.find(product => product.id === productId);
    if (selected) selected.hidden = false;
    applyCatalogAdminRecords(records);
    if (!await commitCatalogMutation(snapshot, { message: `DESTAQUE DO CATÁLOGO · ${selected?.name || productId}` })) return;
    showToast(`${selected?.name || 'PRODUTO'} DEFINIDO COMO DESTAQUE`);
  }

  async function toggleCatalogProductVisibility(productId) {
    const snapshot = snapshotCatalogState();
    const records = getCatalogAdminRecords();
    const product = records.find(item => item.id === productId);
    if (!product) return;
    product.hidden = !product.hidden;
    if (product.hidden && product.featured) {
      product.featured = false;
      const next = records.find(item => !item.hidden && item.id !== product.id);
      if (next) next.featured = true;
    }
    applyCatalogAdminRecords(records);
    if (!await commitCatalogMutation(snapshot, { message: `${product.hidden ? 'PRODUTO OCULTADO' : 'PRODUTO PUBLICADO'} · ${product.name}` })) return;
    showToast(product.hidden ? 'PRODUTO OCULTADO DA VITRINE' : 'PRODUTO PUBLICADO');
  }

  async function duplicateCatalogProduct(productId) {
    const snapshot = snapshotCatalogState();
    const records = getCatalogAdminRecords().sort((a, b) => a.priority - b.priority);
    const source = records.find(product => product.id === productId);
    if (!source) return;
    let id = slugifyCatalogId(`${source.id}_copia`);
    let suffix = 2;
    while (records.some(product => product.id === id)) id = slugifyCatalogId(`${source.id}_copia_${suffix++}`);
    records.push(normalizeCatalogAdminRecord({ ...source, id, name: `${source.name} Cópia`, featured: false, hidden: true, priority: records.length, updatedAt: new Date().toISOString() }));
    applyCatalogAdminRecords(renumberCatalogPriorities(records));
    if (!await commitCatalogMutation(snapshot, { message: `PRODUTO DUPLICADO · ${source.name}` })) return;
    openCatalogAdminEditor(id);
  }

  async function deleteCatalogProduct(productId) {
    const snapshot = snapshotCatalogState();
    const records = getCatalogAdminRecords();
    const product = records.find(item => item.id === productId);
    if (!product) return;
    if (!confirm(`Remover permanentemente o produto “${product.name}” do catálogo? Pedidos antigos não serão apagados.`)) return;
    const remaining = records.filter(item => item.id !== productId);
    if (!remaining.length) {
      showToast('O CATÁLOGO PRECISA TER PELO MENOS UM PRODUTO', 'error');
      return;
    }
    if (product.featured) {
      const next = remaining.find(item => !item.hidden) || remaining[0];
      next.featured = true;
      next.hidden = false;
    }
    applyCatalogAdminRecords(renumberCatalogPriorities(remaining));
    if (!await commitCatalogMutation(snapshot, { message: `PRODUTO REMOVIDO · ${product.name}` })) return;
    showToast('PRODUTO REMOVIDO DO CATÁLOGO');
  }

  function catalogEditorFieldValue(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function renderCatalogEditorGallery() {
    const container = document.getElementById('catalogEditorGalleryList');
    if (!container) return;
    if (!catalogAdminGalleryDraft.length) {
      container.innerHTML = '<div class="catalog-editor-gallery-empty">SEM IMAGENS ADICIONAIS</div>';
      return;
    }
    container.innerHTML = catalogAdminGalleryDraft.map((source, index) => `
      <figure class="catalog-editor-gallery-item">
        <img src="${escapeHtml(source)}" alt="Imagem ${index + 1}">
        <button type="button" data-gallery-main="${index}" title="Usar como capa">CAPA</button>
        <button type="button" data-gallery-remove="${index}" title="Remover">✕</button>
      </figure>`).join('');
    container.querySelectorAll('[data-gallery-remove]').forEach(button => button.addEventListener('click', () => {
      catalogAdminGalleryDraft.splice(Number(button.dataset.galleryRemove), 1);
      renderCatalogEditorGallery();
    }));
    container.querySelectorAll('[data-gallery-main]').forEach(button => button.addEventListener('click', () => {
      catalogAdminMainImageDraft = catalogAdminGalleryDraft[Number(button.dataset.galleryMain)] || catalogAdminMainImageDraft;
      const input = document.getElementById('catalogEditorImagePath');
      if (input) input.value = catalogAdminMainImageDraft;
      updateCatalogEditorImagePreview();
    }));
  }

  function updateCatalogEditorImagePreview() {
    const input = document.getElementById('catalogEditorImagePath');
    if (input?.value.trim()) catalogAdminMainImageDraft = input.value.trim();
    const image = document.getElementById('catalogEditorImagePreview');
    if (image) image.src = catalogAdminMainImageDraft || 'assets/cybershape-unit.png';
  }

  function readCatalogImageFile(file, maxDimension = 1600, quality = 0.86) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) return reject(new Error('Arquivo não é imagem'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler imagem'));
      reader.onload = event => {
        const image = new Image();
        image.onerror = () => reject(new Error('Imagem inválida'));
        image.onload = () => {
          const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          let output;
          try { output = canvas.toDataURL('image/webp', quality); }
          catch (error) { output = canvas.toDataURL('image/jpeg', quality); }
          resolve(output);
        };
        image.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleCatalogMainImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      catalogAdminMainImageDraft = await readCatalogImageFile(file);
      const input = document.getElementById('catalogEditorImagePath');
      if (input) input.value = catalogAdminMainImageDraft;
      if (!catalogAdminGalleryDraft.includes(catalogAdminMainImageDraft)) catalogAdminGalleryDraft.unshift(catalogAdminMainImageDraft);
      updateCatalogEditorImagePreview();
      renderCatalogEditorGallery();
      showToast('IMAGEM OTIMIZADA E CARREGADA');
    } catch (error) {
      showToast('NÃO FOI POSSÍVEL CARREGAR A IMAGEM', 'error');
    }
    event.target.value = '';
  }

  async function handleCatalogGalleryUpload(event) {
    const files = Array.from(event.target.files || []).slice(0, 8);
    if (!files.length) return;
    try {
      for (const file of files) {
        const source = await readCatalogImageFile(file, 1400, 0.82);
        if (!catalogAdminGalleryDraft.includes(source)) catalogAdminGalleryDraft.push(source);
      }
      if (!catalogAdminMainImageDraft && catalogAdminGalleryDraft[0]) catalogAdminMainImageDraft = catalogAdminGalleryDraft[0];
      updateCatalogEditorImagePreview();
      renderCatalogEditorGallery();
      showToast(`${files.length} IMAGEM${files.length > 1 ? 'ENS' : ''} ADICIONADA${files.length > 1 ? 'S' : ''}`);
    } catch (error) {
      showToast('UMA OU MAIS IMAGENS NÃO PUDERAM SER PROCESSADAS', 'error');
    }
    event.target.value = '';
  }

  function openCatalogAdminEditor(productId = null) {
    if (loadSettings().mode !== 'admin') {
      showToast('FUNÇÃO DISPONÍVEL SOMENTE NO MODO ADMIN', 'error');
      return;
    }
    const records = getCatalogAdminRecords();
    const existing = productId ? records.find(product => product.id === productId) : null;
    const product = normalizeCatalogAdminRecord(existing || {
      id: `produto_${Date.now().toString(36)}`,
      name: 'Novo artefato',
      line: 'TRIAXIS PRODUCT',
      img: 'assets/cybershape-unit.png',
      basePrice: 0,
      description: 'Descreva o novo artefato TriAxis.',
      category: 'services',
      categoryLabel: 'Serviços',
      priority: records.length,
      hidden: true,
      featured: false
    }, records.length);
    catalogAdminEditingId = existing?.id || null;
    catalogAdminMainImageDraft = product.img;
    catalogAdminGalleryDraft = product.gallery.slice();
    const content = document.getElementById('catalogAdminEditorContent');
    const title = document.getElementById('catalogAdminEditorTitle');
    if (title) title.textContent = existing ? `EDITAR · ${product.name}` : 'NOVO PRODUTO';
    if (!content) return;
    content.innerHTML = `
      <form id="catalogAdminEditorForm" class="catalog-admin-editor-form">
        <div class="catalog-admin-editor-grid">
          <aside class="catalog-editor-media-panel">
            <div class="catalog-editor-main-image"><img id="catalogEditorImagePreview" src="${escapeHtml(product.img)}" alt="Prévia do produto"></div>
            <div class="form-field"><label for="catalogEditorImagePath">IMAGEM PRINCIPAL · CAMINHO, URL OU BASE64</label><input id="catalogEditorImagePath" type="text" value="${escapeHtml(product.img)}"></div>
            <label class="btn btn-primary btn-block catalog-upload-button" for="catalogEditorMainImageInput">CARREGAR IMAGEM DO COMPUTADOR</label>
            <input id="catalogEditorMainImageInput" type="file" accept="image/*" hidden>
            <div class="catalog-editor-media-note">A imagem é otimizada e salva localmente no navegador. Para publicação online definitiva, substitua por um caminho de arquivo em <code>assets/</code>.</div>
            <div class="catalog-editor-gallery-head"><strong>GALERIA DO ANÚNCIO</strong><label for="catalogEditorGalleryInput">+ ADICIONAR</label><input id="catalogEditorGalleryInput" type="file" accept="image/*" multiple hidden></div>
            <div id="catalogEditorGalleryList" class="catalog-editor-gallery-list"></div>
          </aside>

          <div class="catalog-editor-fields-panel">
            <div class="catalog-editor-section"><span>01</span><div><strong>IDENTIFICAÇÃO</strong><small>Nome, código interno e linha comercial.</small></div></div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorName">NOME DO PRODUTO</label><input id="catalogEditorName" type="text" value="${escapeHtml(product.name)}" required maxlength="80"></div>
              <div class="form-field"><label for="catalogEditorId">ID INTERNO</label><input id="catalogEditorId" type="text" value="${escapeHtml(product.id)}" ${existing ? 'readonly' : ''} required maxlength="48"></div>
            </div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorLine">LINHA / SELO</label><input id="catalogEditorLine" type="text" value="${escapeHtml(product.line)}" maxlength="60"></div>
              <div class="form-field"><label for="catalogEditorType">TIPO DO ARTEFATO</label><input id="catalogEditorType" type="text" value="${escapeHtml(product.type)}" maxlength="60"></div>
            </div>

            <div class="catalog-editor-section"><span>02</span><div><strong>VENDA E DISPONIBILIDADE</strong><small>Preço, prazo, categoria e status público.</small></div></div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorPrice">PREÇO BASE</label><input id="catalogEditorPrice" type="number" min="0" step="0.01" value="${product.basePrice}"></div>
              <div class="form-field"><label for="catalogEditorProductionTime">PRAZO</label><input id="catalogEditorProductionTime" type="text" value="${escapeHtml(product.productionTime)}" maxlength="40"></div>
            </div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorCategory">CHAVE DA CATEGORIA</label><input id="catalogEditorCategory" type="text" value="${escapeHtml(product.category)}" maxlength="40"></div>
              <div class="form-field"><label for="catalogEditorCategoryLabel">NOME DA CATEGORIA</label><input id="catalogEditorCategoryLabel" type="text" value="${escapeHtml(product.categoryLabel)}" maxlength="60"></div>
            </div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorAvailability">CÓDIGO DO STATUS</label><select id="catalogEditorAvailability"><option value="available" ${product.availability === 'available' ? 'selected' : ''}>Disponível</option><option value="custom_order" ${product.availability === 'custom_order' ? 'selected' : ''}>Sob encomenda</option><option value="limited" ${product.availability === 'limited' ? 'selected' : ''}>Edição limitada</option><option value="prototype" ${product.availability === 'prototype' ? 'selected' : ''}>Protótipo</option><option value="unavailable" ${product.availability === 'unavailable' ? 'selected' : ''}>Indisponível</option></select></div>
              <div class="form-field"><label for="catalogEditorAvailabilityLabel">TEXTO DO STATUS</label><input id="catalogEditorAvailabilityLabel" type="text" value="${escapeHtml(product.availabilityLabel)}" maxlength="50"></div>
            </div>

            <div class="catalog-editor-section"><span>03</span><div><strong>CONTEÚDO DO ANÚNCIO</strong><small>Descrição, personalização e informações técnicas.</small></div></div>
            <div class="form-field"><label for="catalogEditorDescription">DESCRIÇÃO</label><textarea id="catalogEditorDescription" rows="4" maxlength="700">${escapeHtml(product.description)}</textarea></div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorCustomization">PERSONALIZAÇÃO</label><input id="catalogEditorCustomization" type="text" value="${escapeHtml(product.customization)}" maxlength="160"></div>
              <div class="form-field"><label for="catalogEditorSize">TAMANHO / MEDIDAS</label><input id="catalogEditorSize" type="text" value="${escapeHtml(product.size)}" maxlength="100"></div>
            </div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorSpecs">ESPECIFICAÇÕES · UMA POR LINHA</label><textarea id="catalogEditorSpecs" rows="5">${escapeHtml(product.specs.join('\n'))}</textarea></div>
              <div class="form-field"><label for="catalogEditorMaterials">MATERIAIS · UM POR LINHA</label><textarea id="catalogEditorMaterials" rows="5">${escapeHtml(product.materials.join('\n'))}</textarea></div>
            </div>
            <div class="form-field"><label for="catalogEditorUses">USOS RECOMENDADOS · UM POR LINHA</label><textarea id="catalogEditorUses" rows="4">${escapeHtml(product.uses.join('\n'))}</textarea></div>

            <div class="catalog-editor-section"><span>04</span><div><strong>APARÊNCIA E DESTAQUE</strong><small>Controle individual da apresentação deste anúncio.</small></div></div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorPromoLabel">SELO PROMOCIONAL</label><input id="catalogEditorPromoLabel" type="text" value="${escapeHtml(product.promoLabel)}" placeholder="Ex: NOVO / EDIÇÃO LIMITADA" maxlength="50"></div>
              <div class="form-field"><label for="catalogEditorCtaLabel">TEXTO DO BOTÃO</label><input id="catalogEditorCtaLabel" type="text" value="${escapeHtml(product.ctaLabel)}" maxlength="40"></div>
            </div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorCardStyle">ESTILO DO CARD</label><select id="catalogEditorCardStyle"><option value="standard" ${product.cardStyle === 'standard' ? 'selected' : ''}>Padrão</option><option value="technical" ${product.cardStyle === 'technical' ? 'selected' : ''}>Técnico</option><option value="spotlight" ${product.cardStyle === 'spotlight' ? 'selected' : ''}>Destaque</option><option value="minimal" ${product.cardStyle === 'minimal' ? 'selected' : ''}>Minimalista</option></select></div>
              <div class="form-field"><label for="catalogEditorAccent">COR DE DESTAQUE</label><input id="catalogEditorAccent" type="text" value="${escapeHtml(product.accent)}" placeholder="#E8001C"></div>
            </div>
            <div class="form-row">
              <div class="form-field"><label for="catalogEditorImageFit">AJUSTE DA IMAGEM</label><select id="catalogEditorImageFit"><option value="contain" ${product.imageFit === 'contain' ? 'selected' : ''}>Conter imagem</option><option value="cover" ${product.imageFit === 'cover' ? 'selected' : ''}>Preencher área</option></select></div>
              <div class="catalog-editor-switches">
                <label class="toggle-row"><span>PUBLICADO NA VITRINE</span><input id="catalogEditorPublished" type="checkbox" ${!product.hidden ? 'checked' : ''}><span class="toggle-switch"></span></label>
                <label class="toggle-row"><span>PRODUTO EM DESTAQUE</span><input id="catalogEditorFeatured" type="checkbox" ${product.featured ? 'checked' : ''}><span class="toggle-switch"></span></label>
                <label class="toggle-row"><span>EXIBIR PREÇO</span><input id="catalogEditorShowPrice" type="checkbox" ${product.showPrice ? 'checked' : ''}><span class="toggle-switch"></span></label>
              </div>
            </div>

            <div class="catalog-admin-editor-footer">
              <button type="button" class="btn btn-outline" data-close-modal="modalCatalogAdminEditor">CANCELAR</button>
              <button type="submit" class="btn btn-primary">SALVAR PRODUTO</button>
            </div>
          </div>
        </div>
      </form>`;

    document.getElementById('catalogEditorImagePath')?.addEventListener('input', updateCatalogEditorImagePreview);
    document.getElementById('catalogEditorMainImageInput')?.addEventListener('change', handleCatalogMainImageUpload);
    document.getElementById('catalogEditorGalleryInput')?.addEventListener('change', handleCatalogGalleryUpload);
    document.getElementById('catalogAdminEditorForm')?.addEventListener('submit', saveCatalogProductFromEditor);
    content.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
    renderCatalogEditorGallery();
    openModal('modalCatalogAdminEditor');
  }

  async function saveCatalogProductFromEditor(event) {
    event.preventDefault();
    const snapshot = snapshotCatalogState();
    const records = getCatalogAdminRecords().sort((a, b) => a.priority - b.priority);
    const name = catalogEditorFieldValue('catalogEditorName');
    let id = slugifyCatalogId(catalogEditorFieldValue('catalogEditorId') || name);
    if (!name) {
      showToast('INFORME O NOME DO PRODUTO', 'error');
      document.getElementById('catalogEditorName')?.focus();
      return;
    }
    if (!catalogAdminEditingId && records.some(product => product.id === id)) {
      let suffix = 2;
      const base = id;
      while (records.some(product => product.id === id)) id = `${base}_${suffix++}`;
    }
    const previous = catalogAdminEditingId ? records.find(product => product.id === catalogAdminEditingId) : null;
    const featured = Boolean(document.getElementById('catalogEditorFeatured')?.checked);
    const record = normalizeCatalogAdminRecord({
      ...(previous || {}),
      id: previous?.id || id,
      name,
      line: catalogEditorFieldValue('catalogEditorLine'),
      img: catalogAdminMainImageDraft || catalogEditorFieldValue('catalogEditorImagePath') || 'assets/cybershape-unit.png',
      basePrice: Number(document.getElementById('catalogEditorPrice')?.value || 0),
      productionTime: catalogEditorFieldValue('catalogEditorProductionTime'),
      description: catalogEditorFieldValue('catalogEditorDescription'),
      specs: toStringList(document.getElementById('catalogEditorSpecs')?.value),
      category: slugifyCatalogId(catalogEditorFieldValue('catalogEditorCategory') || 'services'),
      categoryLabel: catalogEditorFieldValue('catalogEditorCategoryLabel') || 'Serviços',
      type: catalogEditorFieldValue('catalogEditorType'),
      availability: document.getElementById('catalogEditorAvailability')?.value || 'custom_order',
      availabilityLabel: catalogEditorFieldValue('catalogEditorAvailabilityLabel') || 'Sob encomenda',
      customization: catalogEditorFieldValue('catalogEditorCustomization'),
      size: catalogEditorFieldValue('catalogEditorSize'),
      materials: toStringList(document.getElementById('catalogEditorMaterials')?.value),
      uses: toStringList(document.getElementById('catalogEditorUses')?.value),
      gallery: Array.from(new Set([catalogAdminMainImageDraft, ...catalogAdminGalleryDraft].filter(Boolean))),
      hidden: !document.getElementById('catalogEditorPublished')?.checked,
      featured,
      priority: previous?.priority ?? records.length,
      promoLabel: catalogEditorFieldValue('catalogEditorPromoLabel'),
      ctaLabel: catalogEditorFieldValue('catalogEditorCtaLabel') || 'SOLICITAR ARTEFATO',
      cardStyle: document.getElementById('catalogEditorCardStyle')?.value || 'standard',
      accent: catalogEditorFieldValue('catalogEditorAccent'),
      imageFit: document.getElementById('catalogEditorImageFit')?.value || 'contain',
      showPrice: Boolean(document.getElementById('catalogEditorShowPrice')?.checked),
      updatedAt: new Date().toISOString()
    }, previous?.priority ?? records.length);
    if (featured) {
      records.forEach(product => { product.featured = false; });
      record.hidden = false;
    }
    const index = records.findIndex(product => product.id === record.id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    if (!records.some(product => product.featured && !product.hidden)) {
      const first = records.find(product => !product.hidden) || record;
      first.featured = true;
      first.hidden = false;
    }
    applyCatalogAdminRecords(renumberCatalogPriorities(records));
    if (!await commitCatalogMutation(snapshot, { message: `${previous ? 'PRODUTO ALTERADO' : 'PRODUTO CRIADO'} · ${record.name}` })) return;
    closeModal('modalCatalogAdminEditor');
    showToast(previous ? 'PRODUTO ATUALIZADO' : 'NOVO PRODUTO CRIADO');
  }

  function exportCatalogAdminData() {
    const payload = getCatalogAdminState();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `triaxis-catalogo-v4-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog('CATÁLOGO EXPORTADO EM JSON');
    showToast('CATÁLOGO EXPORTADO');
  }

  function importCatalogAdminData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('ARQUIVO DE CATÁLOGO MUITO GRANDE', 'error');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async loadEvent => {
      const snapshot = snapshotCatalogState();
      try {
        const data = JSON.parse(loadEvent.target.result);
        if (Array.isArray(data.products) && data.products.length > 500) throw new Error('CATALOG_TOO_LARGE');
        if (!Array.isArray(data.products) || !data.products.length) throw new Error('Catálogo sem produtos');
        applyCatalogAdminRecords(data.products);
        catalogLayout = normalizeCatalogLayout(data.layout || catalogLayout);
        if (!await commitCatalogMutation(snapshot, { message: `CATÁLOGO IMPORTADO · ${data.products.length} PRODUTOS` })) throw new Error('Falha ao persistir catálogo');
        showToast('CATÁLOGO IMPORTADO COM SUCESSO');
      } catch (error) {
        restoreCatalogState(snapshot);
        console.error(error);
        showToast('ARQUIVO DE CATÁLOGO INVÁLIDO', 'error');
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  }

  async function resetCatalogAdminData() {
    if (!confirm('Restaurar o catálogo original da TriAxis Nexus V4? Todas as alterações de produtos e layout serão removidas.')) return;
    if (!confirm('Confirmação final: deseja realmente apagar a configuração atual do catálogo?')) return;
    const snapshot = snapshotCatalogState();
    applyCatalogAdminRecords(JSON.parse(JSON.stringify(DEFAULT_CATALOG_SNAPSHOT.products)));
    catalogLayout = normalizeCatalogLayout(DEFAULT_CATALOG_SNAPSHOT.layout);
    if (!await commitCatalogMutation(snapshot, { message: 'CATÁLOGO RESTAURADO PARA O PADRÃO V4' })) return;
    showToast('CATÁLOGO PADRÃO RESTAURADO');
  }

  function initCatalogAdminControls() {
    document.getElementById('btnCatalogStorefrontTab')?.addEventListener('click', () => setCatalogPanel('storefront'));
    document.getElementById('btnCatalogAdminTab')?.addEventListener('click', () => setCatalogPanel('admin'));
    document.getElementById('btnCatalogAdminNew')?.addEventListener('click', () => openCatalogAdminEditor());
    document.getElementById('btnCatalogAdminExport')?.addEventListener('click', exportCatalogAdminData);
    document.getElementById('catalogAdminImportInput')?.addEventListener('change', importCatalogAdminData);
    document.getElementById('btnCatalogAdminSaveLayout')?.addEventListener('click', () => saveCatalogLayoutFromPanel());
    document.getElementById('btnCatalogAdminSaveFeatured')?.addEventListener('click', () => saveCatalogLayoutFromPanel('TEXTO DO DESTAQUE ATUALIZADO'));
    document.getElementById('btnCatalogAdminReset')?.addEventListener('click', resetCatalogAdminData);
    document.getElementById('catalogAdminSearch')?.addEventListener('input', renderCatalogAdminProductList);
    document.getElementById('catalogAdminStatusFilter')?.addEventListener('change', renderCatalogAdminProductList);
  }


  function getProductionMatches() {
    const q = (document.getElementById('productionFilterText')?.value || '').trim().toUpperCase();
    const status = document.getElementById('productionFilterStatus')?.value || 'all';
    return physicalRequests.filter(req => {
      const hay = `${req.name} ${req.tag} ${req.qrId} ${req.productName} ${req.productVariantLabel}`.toUpperCase();
      const textOk = !q || hay.includes(q);
      const statusOk = status === 'all' || req.status === status;
      return textOk && statusOk;
    });
  }

  function renderProductionDashboard(matches = physicalRequests) {
    const dash = document.getElementById('productionDashboard');
    if (!dash) return;
    const count = (status) => matches.filter(req => req.status === status).length;
    const revenue = matches.reduce((sum, req) => sum + Number(req.estimatedPrice || 0), 0);
    dash.innerHTML = `
      <div class="prod-stat"><span>TOTAL</span><strong>${matches.length}</strong></div>
      <div class="prod-stat"><span>RECEBIDOS</span><strong>${count('Pedido recebido')}</strong></div>
      <div class="prod-stat"><span>PAGAMENTO</span><strong>${count('Aguardando comprovação') + count('Comprovação recebida') + count('Em validação')}</strong></div>
      <div class="prod-stat"><span>APROVADOS</span><strong>${count('Aprovado para produção')}</strong></div>
      <div class="prod-stat"><span>EM PRODUÇÃO</span><strong>${count('Em produção')}</strong></div>
      <div class="prod-stat"><span>PRONTOS</span><strong>${count('Pronto')}</strong></div>
      <div class="prod-stat"><span>ESTIMATIVA</span><strong>${formatCurrencyBRL(revenue)}</strong></div>`;
  }

  function renderProduction() {
    const board = document.getElementById('productionBoard');
    if (!board) return;
    const matches = getProductionMatches().sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    renderProductionDashboard(matches);
    if (!matches.length) {
      board.innerHTML = '<div class="empty-state visible"><div class="empty-icon">▢</div><p>NENHUM PEDIDO ENCONTRADO</p><small>Solicite um ID físico ou ajuste os filtros de produção</small></div>';
      return;
    }
    board.innerHTML = matches.map(req => `
      <article class="production-card hud-frame">
        <span class="hud-corner tl"></span><span class="hud-corner br"></span>
        <div class="production-card-head">
          <div><span>${escapeHtml(req.productName || getCatalogProduct(req.productId).name)}</span><h3>${escapeHtml(req.name)}</h3></div>
          <b>${escapeHtml(req.tag)}</b>
        </div>
        ${renderPhysicalProgress(req.status)}
        <div class="production-card-grid">
          <p><b>Versão</b><span>${escapeHtml(req.productVariantLabel || getVariantLabel(req.productVariant))}</span></p>
          <p><b>Material</b><span>${escapeHtml(req.materialLabel || getPhysicalOptionLabel('material', req.material))}</span></p>
          <p><b>Acabamento</b><span>${escapeHtml(req.finishLabel || getPhysicalOptionLabel('finish', req.finish))}</span></p>
          <p><b>Acessório</b><span>${escapeHtml(req.accessoryLabel || getPhysicalOptionLabel('accessory', req.accessory))}</span></p>
          <p><b>Preço</b><span>${formatCurrencyBRL(req.estimatedPrice)}</span></p>
          <p><b>Pedido</b><span>${formatTime(req.requestedAt)}</span></p>
          <p><b>Origem</b><span>${escapeHtml(req.origin || (req.orderCode ? 'Catálogo' : 'ID físico'))}</span></p>
          <p><b>Código</b><span>${escapeHtml(req.orderCode || req.id || '—')}</span></p>
          <p><b>Prazo</b><span>${escapeHtml(req.deadline || 'sob consulta')}</span></p>
          ${req.paymentReference ? `<p><b>Comprovação</b><span>${escapeHtml(req.paymentReference)}</span></p>` : ''}
          ${req.refundRecipient ? `<p><b>Reembolso</b><span>${formatCurrencyBRL(req.refundAmount)} · ${escapeHtml(req.refundRecipient)}</span></p>` : ''}
          ${req.refundReference ? `<p><b>Ref. reembolso</b><span>${escapeHtml(req.refundReference)}</span></p>` : ''}
          ${req.trackingCode ? `<p><b>Rastreio</b><span>${escapeHtml(req.trackingCode)}</span></p>` : ''}
        </div>
        ${renderOrderHistory(req)}
        <div class="production-card-actions">
          <select class="toolbar-select" data-request-status="${escapeHtml(req.id)}">${renderPhysicalStatusOptions(req)}</select>
          <button class="btn btn-outline btn-sm" data-open-id="${escapeHtml(req.tag)}" type="button">ABRIR ID</button>
          <button class="btn btn-primary btn-sm" data-order-png="${escapeHtml(req.id)}" type="button">ORDEM PNG</button>
        </div>
      </article>`).join('');
    board.querySelectorAll('[data-request-status]').forEach(sel => sel.addEventListener('change', () => updatePhysicalRequestStatus(sel.getAttribute('data-request-status'), sel.value)));
    board.querySelectorAll('[data-open-id]').forEach(btn => btn.addEventListener('click', () => openIdCard(btn.getAttribute('data-open-id'))));
    board.querySelectorAll('[data-order-png]').forEach(btn => btn.addEventListener('click', () => downloadProductionOrderPng(btn.getAttribute('data-order-png'))));
  }

  function getCatalogProduct(productId = currentPhysicalProduct) {
    return CATALOG_PRODUCTS.find((product) => product.id === productId) || CATALOG_PRODUCTS.find((product) => !product.hidden) || CATALOG_PRODUCTS[0];
  }

  function getPhysicalProductViews(product = getCatalogProduct()) {
    if (product.id === 'vector_sigil') {
      return {
        front: 'assets/vector-sigil-front-hero.png',
        back: 'assets/vector-sigil-back.png',
        side: 'assets/vector-sigil-side.png',
        concept: 'assets/vector-sigil-vistas-panel.png'
      };
    }
    const gallery = Array.isArray(product.gallery) ? product.gallery.filter(Boolean) : [];
    return {
      front: gallery[0] || product.img,
      back: gallery[1] || gallery[0] || product.img,
      side: gallery[2] || gallery[0] || product.img,
      concept: gallery[3] || gallery[0] || product.img
    };
  }

  function getVariantLabel(variant = currentPhysicalVariant) {
    return PHYSICAL_VARIANTS[variant]?.label || 'Standard';
  }

  function updatePhysicalProductSummary() {
    const productSelect = document.getElementById('physicalProductSelect');
    const variantSelect = document.getElementById('physicalVariantSelect');
    if (productSelect) currentPhysicalProduct = productSelect.value || currentPhysicalProduct;
    if (variantSelect) currentPhysicalVariant = variantSelect.value || currentPhysicalVariant;
    const product = getCatalogProduct(currentPhysicalProduct);
    const variant = PHYSICAL_VARIANTS[currentPhysicalVariant] || PHYSICAL_VARIANTS.standard;
    const summary = document.getElementById('physicalProductSummary');
    if (summary) summary.textContent = `${product.name} ${variant.label} · ${variant.desc}`;
    setText('physicalModalProduct', product.name);
    setText('physicalModalVariant', variant.label);
    updatePhysicalPricePreview();
    renderPhysicalKeychainPreview(findAgentByTag(currentPhysicalTag), currentPhysicalSide);
  }

  function setPhysicalProduct(productId = 'vector_sigil', variant = 'standard') {
    currentPhysicalProduct = productId;
    currentPhysicalVariant = variant;
    const productSelect = document.getElementById('physicalProductSelect');
    const variantSelect = document.getElementById('physicalVariantSelect');
    if (productSelect) productSelect.value = productId;
    if (variantSelect) variantSelect.value = variant;
    updatePhysicalProductSummary();
  }

  function getPhysicalOptionLabel(group, value) {
    return PHYSICAL_ORDER_OPTIONS[group]?.[value]?.label || value || '—';
  }

  function estimatePhysicalPrice(material = 'pla_fosco', finish = 'simples', accessory = 'ball_chain', productId = currentPhysicalProduct, variant = currentPhysicalVariant) {
    const product = getCatalogProduct(productId);
    const v = PHYSICAL_VARIANTS[variant]?.price || 0;
    const m = getMaterialSurcharge(material);
    const f = PHYSICAL_ORDER_OPTIONS.finish[finish]?.price || 0;
    const a = PHYSICAL_ORDER_OPTIONS.accessory[accessory]?.price || 0;
    const base = product?.basePrice || 0;
    return Math.round((base + v + m + f + a) * 100) / 100;
  }

  function getMaterialSurcharge(material = 'pla_fosco') {
    const standard = PHYSICAL_ORDER_OPTIONS.material.pla_fosco.price;
    const selected = PHYSICAL_ORDER_OPTIONS.material[material]?.price ?? standard;
    return Math.round((selected - standard) * 100) / 100;
  }

  function formatCurrencyBRL(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function getPhysicalOrderSelection() {
    const material = document.getElementById('physicalMaterialSelect')?.value || 'pla_fosco';
    const finish = document.getElementById('physicalFinishSelect')?.value || 'simples';
    const accessory = document.getElementById('physicalAccessorySelect')?.value || 'ball_chain';
    const product = getCatalogProduct(currentPhysicalProduct);
    const variant = PHYSICAL_VARIANTS[currentPhysicalVariant] || PHYSICAL_VARIANTS.standard;
    const estimatedPrice = estimatePhysicalPrice(material, finish, accessory, product.id, currentPhysicalVariant);
    return {
      material,
      materialLabel: getPhysicalOptionLabel('material', material),
      finish,
      finishLabel: getPhysicalOptionLabel('finish', finish),
      accessory,
      accessoryLabel: getPhysicalOptionLabel('accessory', accessory),
      productId: product.id,
      productName: product.name,
      productVariant: currentPhysicalVariant,
      productVariantLabel: variant.label,
      estimatedPrice
    };
  }

  function updatePhysicalPricePreview() {
    const priceEl = document.getElementById('physicalModalPrice');
    if (!priceEl) return;
    const selection = getPhysicalOrderSelection();
    priceEl.textContent = formatCurrencyBRL(selection.estimatedPrice);
  }

  function renderPhysicalProgress(status) {
    const current = PHYSICAL_STATUSES.indexOf(status);
    return `<div class="physical-progress">${PHYSICAL_STATUSES.map((step, index) => `<span class="${current >= 0 && index <= current ? 'done' : ''}"><i></i>${escapeHtml(step)}</span>`).join('')}</div>`;
  }

  function renderPhysicalStatusOptions(request) {
    const currentStatus = typeof request === 'string' ? request : request?.status;
    const options = request?.remote && window.TriAxisOrders
      ? window.TriAxisOrders.allowedStatusOptions(request.remoteStatus)
      : PHYSICAL_STATUSES.map((value) => ({ value }));
    return options.map(({ value }) => `<option ${value === currentStatus ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  }

  function loadImageForCanvas(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function downloadPhysicalPreviewPng() {
    const agent = findAgentByTag(currentPhysicalTag || currentIdTag);
    if (!agent) { showToast('SELECIONE UM AGENTE PARA BAIXAR A PRÉVIA', 'error'); return; }

    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1050;
    const ctx = canvas.getContext('2d');
    const red = getComputedStyle(document.body).getPropertyValue('--c-red').trim() || '#E8001C';

    ctx.fillStyle = '#020202';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createRadialGradient(800, 240, 80, 800, 520, 860);
    bg.addColorStop(0, 'rgba(232,0,28,.16)');
    bg.addColorStop(.42, 'rgba(20,20,20,.9)');
    bg.addColorStop(1, '#020202');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = red;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(96, 94);
    ctx.lineTo(520, 94);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 28px Share Tech Mono, monospace';
    ctx.fillText('VISTAS DO PRODUTO', 96, 78);
    ctx.fillStyle = red;
    ctx.font = '700 54px Orbitron, sans-serif';
    ctx.fillText(getCatalogProduct(currentPhysicalProduct).name.toUpperCase().slice(0, 22), 96, 158);
    ctx.fillStyle = '#888888';
    ctx.font = '22px Share Tech Mono, monospace';
    ctx.fillText(`${agent.tag} // ${agent.name}`.toUpperCase(), 96, 196);

    try {
      const product = getCatalogProduct(currentPhysicalProduct);
      const board = await loadImageForCanvas(getPhysicalProductViews(product).concept);
      const maxW = 1180, maxH = 620;
      const scale = Math.min(maxW / board.width, maxH / board.height);
      const w = board.width * scale;
      const h = board.height * scale;
      ctx.drawImage(board, (canvas.width - w) / 2, 250, w, h);
    } catch (e) {
      ctx.fillStyle = '#111';
      ctx.fillRect(250, 270, 1100, 520);
      ctx.strokeStyle = red;
      ctx.strokeRect(250, 270, 1100, 520);
    }

    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(96, 850, 1408, 130);
    ctx.strokeStyle = 'rgba(232,0,28,.55)';
    ctx.strokeRect(96, 850, 1408, 130);

    ctx.fillStyle = '#888';
    ctx.font = '18px Share Tech Mono, monospace';
    ctx.fillText('AGENTE', 126, 890);
    ctx.fillText('TAG', 126, 930);
    ctx.fillText('QR ID', 620, 890);
    ctx.fillText('STATUS', 620, 930);

    ctx.fillStyle = '#fff';
    ctx.font = '700 24px Oxanium, sans-serif';
    ctx.fillText(String(agent.name).toUpperCase().slice(0, 28), 230, 890);
    ctx.font = '700 24px Share Tech Mono, monospace';
    ctx.fillStyle = red;
    ctx.fillText(agent.tag, 230, 930);
    ctx.fillStyle = '#fff';
    ctx.font = '18px Share Tech Mono, monospace';
    ctx.fillText(String(agent.qrId || '—').slice(0, 38), 710, 890);
    ctx.fillText(String(agent.status || 'Autorizado').toUpperCase(), 710, 930);

    if (!drawQrCanvas(ctx, agent, 1334, 866, 92)) {
      showToast('QR REAL INDISPONIVEL - EXPORTACAO CANCELADA', 'error');
      return;
    }

    const link = document.createElement('a');
    link.download = `triaxis-${getCatalogProduct(currentPhysicalProduct).id}-${String(agent.tag || 'ID').replace('#', '')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    addLog(`PRÉVIA ID FÍSICO EXPORTADA · ${agent.tag}`);
    showToast('PRÉVIA DO ID FÍSICO BAIXADA EM PNG');
  }


  /* ── Configurações / dados ───────────────────────────────────────── */
  function renderSettings() {
    setText('statTotal', agents.length);
    if (agents.length > 0) {
      const sorted = agents.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setText('statLast', formatDate(sorted[0].createdAt));
    } else setText('statLast', '—');
    const bytes = new Blob([JSON.stringify({ agents, physicalRequests, catalog: getCatalogAdminState() })]).size;
    setText('statStorage', `${(bytes / 1024).toFixed(1)} KB`);
    renderSystemLog();
  }

  function renderDashboard() {
    setText('dashTotal', agents.length);
    setText('dashActive', agents.filter(a => a.status === 'Autorizado').length);
    setText('dashReview', agents.filter(a => a.status === 'Em análise').length);
    setText('dashBlocked', agents.filter(a => a.status === 'Bloqueado').length);
  }

  function renderSystemLog() {
    const el = document.getElementById('systemLog');
    if (!el) return;
    const log = loadLog();
    if (!log.length) { el.innerHTML = '<div class="log-line">SEM EVENTOS REGISTRADOS</div>'; return; }
    el.innerHTML = log.slice(0, 40).map(item => `<div class="log-line"><span class="log-time">${formatTime(item.at)}</span>${escapeHtml(item.message)}</div>`).join('');
  }

  function applySettings(settings) {
    const effectiveMode = hasRemoteRole('admin') && settings.mode === 'admin' ? 'admin' : 'client';
    document.body.classList.toggle('scanlines-off', !settings.scanlines);
    document.body.classList.toggle('glitch-off', !settings.glitch);
    document.body.classList.toggle('noise-off', !settings.noise);
    document.body.dataset.theme = settings.theme || 'classic';
    document.body.dataset.mode = effectiveMode;
    document.body.dataset.productionAccess = canAccessProduction() ? 'true' : 'false';
    setChecked('toggleScanlines', settings.scanlines);
    setChecked('toggleGlitch', settings.glitch);
    setChecked('toggleNoise', settings.noise);
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = settings.theme || 'classic';
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
      modeSelect.value = effectiveMode;
      modeSelect.disabled = !hasRemoteRole('admin');
    }
    updateTestModeButton(effectiveMode);
    if (effectiveMode === 'client' && document.getElementById('catalogAdminPanel')?.classList.contains('active')) {
      setCatalogPanel('storefront');
    }
  }

  function isClientSimulationMode() {
    return !hasRemoteRole('admin') || loadSettings().mode === 'client';
  }

  function requireAdminMode() {
    if (hasRemoteRole('admin') && !isClientSimulationMode()) return true;
    showToast('AÇÃO ADMINISTRATIVA BLOQUEADA · CONTA ADMIN NECESSÁRIA', 'error');
    return false;
  }

  function updateTestModeButton(mode) {
    const label = document.getElementById('testModeLabel');
    const btn = document.getElementById('btnTestMode');
    const normalized = mode === 'client' ? 'client' : 'admin';
    if (label) label.textContent = normalized === 'client' ? 'CLIENTE' : 'ADMIN';
    if (btn) {
      btn.hidden = !hasRemoteRole('admin');
      btn.setAttribute('aria-label', normalized === 'client' ? 'Voltar para modo admin' : 'Alternar para modo cliente');
    }
  }

  function toggleTestMode() {
    if (!hasRemoteRole('admin')) {
      showToast('ALTERAÇÃO DE MODO EXCLUSIVA PARA ADMINISTRADOR', 'error');
      return;
    }
    const settings = loadSettings();
    settings.mode = (settings.mode || 'admin') === 'client' ? 'admin' : 'client';
    saveSettings(settings);
    applySettings(settings);
    const targetView = settings.mode === 'client' && ['bank', 'production', 'settings'].some((view) => document.getElementById('view-' + view)?.classList.contains('active')) ? 'home' : null;
    if (targetView) switchView(targetView);
    addLog(`MODO DE TESTE ALTERADO · ${settings.mode === 'client' ? 'CLIENTE' : 'ADMIN'}`);
    showToast(`MODO ${settings.mode === 'client' ? 'CLIENTE' : 'ADMIN'} ATIVADO`);
  }

  function handleSettingsToggle(key, value) {
    const settings = loadSettings();
    settings[key] = value;
    saveSettings(settings);
    applySettings(settings);
    addLog(`CONFIGURAÇÃO ALTERADA · ${key}`);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  async function deriveBackupKey(password, salt) {
    if (!window.crypto?.subtle || !window.TextEncoder || !window.TextDecoder) throw new Error('Web Crypto indisponível');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encryptBackupPayload(payload, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(password, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
    return { kind: 'triaxis-encrypted-backup', version: 5, crypto: { kdf: 'PBKDF2-SHA-256', iterations: 250000, cipher: 'AES-256-GCM', salt: bytesToBase64(salt), iv: bytesToBase64(iv) }, ciphertext: bytesToBase64(ciphertext) };
  }

  function downloadEncryptedBackup(envelope, filename) {
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async function decryptBackupPayload(envelope, password) {
    if (envelope?.kind !== 'triaxis-encrypted-backup' || envelope?.version !== 5 || envelope?.crypto?.kdf !== 'PBKDF2-SHA-256' || envelope?.crypto?.cipher !== 'AES-256-GCM' || envelope?.crypto?.iterations !== 250000) throw new Error('Backup criptografado inválido');
    const salt = base64ToBytes(envelope.crypto.salt || '');
    const iv = base64ToBytes(envelope.crypto.iv || '');
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Parâmetros criptográficos inválidos');
    const key = await deriveBackupKey(password, salt);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.ciphertext || ''));
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function isValidPasswordRecord(record) {
    const validShape = /^[a-f0-9]{32}$/i.test(record?.salt || '') && /^[a-f0-9]{64}$/i.test(record?.hash || '');
    if (record?.algo === 'SHA-256') return validShape;
    return record?.algo === 'PBKDF2-SHA-256' && Number.isInteger(Number(record.iterations)) && Number(record.iterations) >= 100000 && Number(record.iterations) <= 1000000 && validShape;
  }

  function getStorageSnapshot(keys) {
    return Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
  }

  function restoreStorageSnapshot(snapshot) {
    Object.entries(snapshot).forEach(([key, value]) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
  }

  async function exportData() {
    const password = prompt('Crie uma senha para proteger este backup (mínimo de 12 caracteres):');
    if (password === null) return;
    if (password.length < 12) { showToast('SENHA DO BACKUP DEVE TER AO MENOS 12 CARACTERES', 'error'); return; }
    const confirmation = prompt('Confirme a senha do backup:');
    if (confirmation !== password) { showToast('AS SENHAS DO BACKUP NÃO CONFEREM', 'error'); return; }
    const payload = { version: 5, exportedAt: new Date().toISOString(), agents: [], physicalRequests: [], catalogState: getCatalogAdminState(), settings: loadSettings(), log: [], passwordVault: {} };
    let envelope;
    try { envelope = await encryptBackupPayload(payload, password); }
    catch (error) { console.error(error); showToast('NÃO FOI POSSÍVEL CRIPTOGRAFAR O BACKUP', 'error'); return; }
    downloadEncryptedBackup(envelope, `triaxis-nexus-v4-backup-${Date.now()}.json`);
    addLog('BACKUP EXPORTADO');
    showToast('BACKUP EXPORTADO COM SUCESSO');
  }

  function validateBackupPayload(data) {
    const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor']);
    const walk = (value, depth = 0) => {
      if (depth > 8) throw new Error('BACKUP_DEPTH_LIMIT');
      if (typeof value === 'string' && value.length > 10000) throw new Error('BACKUP_STRING_LIMIT');
      if (Array.isArray(value)) {
        if (value.length > 500) throw new Error('BACKUP_ARRAY_LIMIT');
        value.forEach(item => walk(item, depth + 1));
      } else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => {
          if (dangerousKeys.has(key)) throw new Error('BACKUP_KEY_INVALID');
          walk(item, depth + 1);
        });
      }
    };
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 5) throw new Error('BACKUP_FORMAT_INVALID');
    walk(data);
    if (!data.catalogState || !Array.isArray(data.catalogState.products) || data.catalogState.products.length > 500) throw new Error('BACKUP_CATALOG_INVALID');
    return data;
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('ARQUIVO DE BACKUP MUITO GRANDE', 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async function (ev) {
      const storageKeys = [CATALOG_ADMIN_STORAGE_KEY, SETTINGS_KEY];
      let storageSnapshot = null;
      let memorySnapshot = null;
      try {
        storageSnapshot = getStorageSnapshot(storageKeys);
        memorySnapshot = { agents, physicalRequests, catalogState: JSON.parse(JSON.stringify(getCatalogAdminState())) };
        const envelope = JSON.parse(ev.target.result);
        const password = prompt('Informe a senha deste backup:');
        if (password === null) { e.target.value = ''; return; }
        const data = validateBackupPayload(await decryptBackupPayload(envelope, password));
        // Backups antigos continuam legíveis, mas PII, pedidos e credenciais locais não voltam a ser fonte ativa.
        data.agents = [];
        data.physicalRequests = [];
        data.log = [];
        data.passwordVault = {};
        const incoming = data.agents;
        if (!Array.isArray(incoming)) throw new Error('Formato inválido');
        const map = new Map(agents.map(a => [a.tag, a]));
        incoming.map(normalizeAgent).forEach(a => map.set(a.tag, a));
        const nextAgents = migrateAgentQrData(Array.from(map.values()));
        if (!data.passwordVault || typeof data.passwordVault !== 'object' || Array.isArray(data.passwordVault)) throw new Error('Cofre de credenciais ausente');
        const nextVault = { ...loadPasswordVault() };
        Object.entries(data.passwordVault).forEach(([tag, record]) => {
          if (!isValidPasswordRecord(record)) throw new Error(`Credencial inválida: ${tag}`);
          nextVault[normalizeTagInput(tag)] = { ...record };
        });
        if (nextAgents.some(agent => !isValidPasswordRecord(nextVault[normalizeTagInput(agent.tag)]))) throw new Error('Backup contém agente sem credencial segura');
        let nextRequests = physicalRequests;
        if (Array.isArray(data.physicalRequests)) {
          const reqMap = new Map(physicalRequests.map(r => [r.id, r]));
          data.physicalRequests.map(normalizePhysicalRequest).forEach(r => reqMap.set(r.id, r));
          nextRequests = Array.from(reqMap.values());
        }
        let nextCatalogState = memorySnapshot.catalogState;
        if (data.catalogState?.products && Array.isArray(data.catalogState.products)) {
          if (!data.catalogState.products.length) throw new Error('Catálogo sem produtos');
          nextCatalogState = { products: data.catalogState.products.map(normalizeCatalogAdminRecord), layout: normalizeCatalogLayout(data.catalogState.layout || {}) };
        }
        const nextSettings = data.settings && typeof data.settings === 'object' ? { ...DEFAULT_SETTINGS, ...data.settings } : loadSettings();
        const nextLog = Array.isArray(data.log) ? data.log.slice(0, 80) : loadLog();
        const serialized = {
          [CATALOG_ADMIN_STORAGE_KEY]: JSON.stringify(nextCatalogState),
          [SETTINGS_KEY]: JSON.stringify(nextSettings)
        };
        Object.entries(serialized).forEach(([key, value]) => localStorage.setItem(key, value));
        clearRuntimeLocalPii();
        agents = nextAgents;
        physicalRequests = nextRequests;
        applyCatalogAdminRecords(nextCatalogState.products);
        catalogLayout = normalizeCatalogLayout(nextCatalogState.layout);
        applySettings(nextSettings);
        addLog(`BACKUP V4 IMPORTADO · ${incoming.length} AGENTES · ${Array.isArray(data.catalogState?.products) ? data.catalogState.products.length : 0} PRODUTOS`);
        renderAllDynamic();
        showToast('BACKUP IMPORTADO COM SUCESSO');
      } catch (err) {
        console.error('Falha ao importar backup:', err);
        if (storageSnapshot) try { restoreStorageSnapshot(storageSnapshot); } catch (rollbackError) { console.error('Falha no rollback do backup:', rollbackError); }
        if (memorySnapshot) {
          agents = memorySnapshot.agents;
          physicalRequests = memorySnapshot.physicalRequests;
          applyCatalogAdminRecords(memorySnapshot.catalogState.products);
          catalogLayout = normalizeCatalogLayout(memorySnapshot.catalogState.layout);
        }
        applySettings(loadSettings());
        renderAllDynamic();
        showToast('BACKUP INVÁLIDO, SENHA INCORRETA OU FALHA DE ARMAZENAMENTO', 'error');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  function clearDatabase() {
    if (!requireAdminMode()) return;
    if (agents.length === 0) { showToast('BANCO DE DADOS JÁ ESTÁ VAZIO', 'error'); return; }
    if (!confirm('Isso apagará TODOS os agentes registrados permanentemente. Continuar?')) return;
    if (!confirm('Confirmação final: os dados NÃO poderão ser recuperados. Apagar tudo?')) return;
    const previousAgents = agents;
    const previousRequests = physicalRequests;
    agents = [];
    physicalRequests = [];
    if (!saveAgents() || !savePhysicalIdRequests()) {
      agents = previousAgents;
      physicalRequests = previousRequests;
      saveAgents();
      savePhysicalIdRequests();
      return;
    }
    addLog('BANCO DE DADOS LIMPO');
    renderAllDynamic();
    showToast('BANCO DE DADOS LIMPO');
  }



  function getOrdersForAgent(tag) {
    const normalized = normalizeTagInput(tag);
    return physicalRequests
      .filter((request) => normalizeTagInput(request.tag) === normalized)
      .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));
  }

  function getOrderQuantity(request) {
    const quantity = Number(request.quantity || request.qty || 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function renderUserProfile() {
    const container = document.getElementById('profileContent');
    if (!container) return;
    const agent = getLoggedAgent();
    if (!agent) {
      container.innerHTML = `
        <div class="profile-login-required hud-frame">
          <span class="hud-corner tl"></span><span class="hud-corner br"></span>
          <p class="eyebrow">// ACCESS REQUIRED</p>
          <h2>LOGIN NECESSÁRIO</h2>
          <p>Entre com uma tag autorizada para abrir o perfil do usuário, ver dados do agente e acompanhar pedidos vinculados.</p>
          <button class="btn btn-primary" id="btnProfileOpenLogin" type="button">ABRIR LOGIN</button>
        </div>`;
      document.getElementById('btnProfileOpenLogin')?.addEventListener('click', openLoginPanel);
      return;
    }

    const orders = getOrdersForAgent(agent.tag);
    const totalPieces = orders.reduce((sum, order) => sum + getOrderQuantity(order), 0);
    const activeOrders = orders.filter((order) => !['Entregue', 'Cancelado', 'Rejeitado', 'Reembolsado'].includes(order.status)).length;
    const statusHtml = PHYSICAL_STATUSES
      .map((status) => {
        const count = orders.filter((order) => order.status === status).length;
        return count ? `<div class="profile-status-pill"><span>${escapeHtml(status)}</span><b>${count}</b></div>` : '';
      })
      .join('') || '<div class="profile-status-pill"><span>Sem pedidos</span><b>0</b></div>';

    const photoStyle = agent.photo ? `style="background-image:url(${agent.photo})"` : '';
    const initials = agent.photo ? '' : getInitialsAvatar(agent.name);
    const orderCards = orders.length ? orders.map((order) => `
      <article class="profile-order-card">
        <div class="profile-order-head">
          <div>
            <h4>${escapeHtml(order.productName || 'Artefato TriAxis')}</h4>
            <small>${escapeHtml(order.id || 'REQ-LOCAL')} · ${formatDate(order.requestedAt)} · ${formatTime(order.requestedAt)}</small>
          </div>
          <span class="profile-order-status">${escapeHtml(order.status || 'Pendente')}</span>
        </div>
        <div class="profile-order-meta">
          <p><b>Peças</b><span>${getOrderQuantity(order)} unidade${getOrderQuantity(order) > 1 ? 's' : ''}</span></p>
          <p><b>Resumo</b><span>${escapeHtml(order.productVariantLabel || order.productVariant || 'Standard')} · ${escapeHtml(order.materialLabel || order.material || 'Material padrão')}</span></p>
          <p><b>Estado</b><span>${escapeHtml(order.status || 'Pendente')} · ${escapeHtml(order.estimatedDays || order.deadline || 'prazo sob análise')}</span></p>
          <p><b>Estimativa</b><span>${formatCurrencyBRL(order.estimatedPrice || 0)}</span></p>
        </div>
        ${renderOrderHistory(order)}
      </article>`).join('') : '<div class="profile-empty-orders">Nenhum pedido vinculado a esta tag ainda.</div>';

    container.innerHTML = `
      <div class="profile-shell">
        <aside class="profile-card hud-frame">
          <span class="hud-corner tl"></span><span class="hud-corner br"></span>
          <div class="profile-photo" ${photoStyle}>${initials}</div>
          <div class="profile-main-data">
            <p class="eyebrow">// AGENTE VINCULADO</p>
            <h2>${escapeHtml(agent.name)}</h2>
            <div class="profile-tag-line">
              <span class="badge badge-red">${escapeHtml(agent.tag)}</span>
              <span class="badge ${getStatusBadgeClass(agent.status)}">${escapeHtml(agent.status || 'Autorizado')}</span>
              <span class="badge">${escapeHtml(agent.level || 'LVL-02')}</span>
            </div>
            <div class="profile-data-list">
              <p><b>Telefone</b><span>${escapeHtml(agent.phone || '—')}</span></p>
              <p><b>Função</b><span>${escapeHtml(agent.role || 'Agente TriAxis')}</span></p>
              <p><b>QR ID</b><span>${escapeHtml(agent.qrId || '—')}</span></p>
              <p><b>Registro</b><span>${formatDate(agent.createdAt)}</span></p>
            </div>
            <div class="profile-actions">
              <button class="btn btn-outline btn-sm" id="btnProfileOpenCatalog" type="button">SOLICITAR ARTEFATO</button>
              <button class="btn btn-outline btn-sm" id="btnProfileLogout" type="button">SAIR</button>
            </div>
          </div>
        </aside>

        <section class="profile-panel hud-frame">
          <span class="hud-corner tl"></span><span class="hud-corner br"></span>
          <div class="profile-stats-grid">
            <div class="profile-stat"><span>Pedidos feitos</span><strong>${orders.length}</strong></div>
            <div class="profile-stat"><span>Peças pedidas</span><strong>${totalPieces}</strong></div>
            <div class="profile-stat"><span>Pedidos ativos</span><strong>${activeOrders}</strong></div>
          </div>
          <h3>Resumo do estado dos pedidos</h3>
          <div class="profile-status-summary">${statusHtml}</div>
          <h3>Pedidos vinculados</h3>
          <div class="profile-orders-list">${orderCards}</div>
        </section>
      </div>`;

    document.getElementById('btnProfileOpenCatalog')?.addEventListener('click', () => switchView('catalog'));
    document.getElementById('btnProfileLogout')?.addEventListener('click', () => { logoutAccess(); renderUserProfile(); });
  }

  /* ── Utilitários ──────────────────────────────────────────────────── */
  function renderAllDynamic() { renderUserProfile(); renderBank(); renderSettings(); renderDashboard(); renderPhysicalIdView(); renderCatalog(); renderProduction(); renderLabGallery(); renderQuoteEstimate(); updatePurchaseGateUi(); }
  function getInitialsAvatar(name) {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '??';
  }
  function formatDate(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '—';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  function formatTime(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '--:--';
    return `${formatDate(isoString)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function buildInternalCode(agent) { return `TX-${Math.abs(hashString(agent.tag + agent.name)).toString(16).toUpperCase().slice(0, 6).padStart(6, '0')}`; }
  function hashString(str) { let h = 0; for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0; return Math.abs(h); }
  function getStatusClass(status) { return status === 'Bloqueado' ? 'status-danger' : status === 'Em análise' ? 'status-review' : status === 'Arquivado' ? 'status-muted' : 'status-ok'; }
  function getStatusBadgeClass(status) { return status === 'Bloqueado' ? 'badge-danger' : status === 'Autorizado' ? 'badge-ok' : 'badge-red'; }
  function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str == null ? '' : String(str); return div.innerHTML; }
  function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
  function setChecked(id, value) { const el = document.getElementById(id); if (el) el.checked = Boolean(value); }
  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'error' ? ' toast-error' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('leaving'); setTimeout(() => toast.remove(), 260); }, 3200);
  }


  function setSidebarHidden(hidden) {
    const shouldHide = Boolean(hidden);
    document.body.classList.toggle('sidebar-hidden', shouldHide);
    try { localStorage.setItem(SIDEBAR_STATE_KEY, shouldHide ? '1' : '0'); } catch (e) {}

    const hideBtn = document.getElementById('btnToggleSidebar');
    const showBtn = document.getElementById('btnShowSidebar');
    const sidebar = document.querySelector('.sidebar');

    if (sidebar) {
      sidebar.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
      sidebar.toggleAttribute('inert', shouldHide);
    }
    if (hideBtn) {
      hideBtn.setAttribute('aria-label', shouldHide ? 'Mostrar barra lateral' : 'Esconder barra lateral');
      hideBtn.setAttribute('aria-expanded', String(!shouldHide));
      hideBtn.textContent = shouldHide ? '⇥' : '⇤';
    }
    if (showBtn) {
      showBtn.setAttribute('aria-hidden', shouldHide ? 'false' : 'true');
      showBtn.setAttribute('aria-expanded', String(!shouldHide));
      showBtn.hidden = !shouldHide;
    }
  }

  function toggleSidebarHidden() {
    setSidebarHidden(!document.body.classList.contains('sidebar-hidden'));
  }

  function restoreSidebarState() {
    let hidden = false;
    try { hidden = localStorage.getItem(SIDEBAR_STATE_KEY) === '1'; } catch (e) {}
    setSidebarHidden(hidden);
  }

  function handleHomeQuickAccess(viewName) {
    switchView(viewName);
  }



  /* ── Add-ons V4: orçamento, verificação, laboratório e exportações ── */
  function calculateQuote() {
    const product = document.getElementById('quoteProduct')?.value || 'Peça customizada';
    const size = document.getElementById('quoteSize')?.value || 'M';
    const material = document.getElementById('quoteMaterial')?.value || 'PLA';
    const finish = document.getElementById('quoteFinish')?.value || 'Bruto';
    const quantityValue = Number(document.getElementById('quoteQty')?.value);
    const quantityValid = Number.isInteger(quantityValue) && quantityValue >= 1 && quantityValue <= 99;
    const qty = quantityValid ? quantityValue : 0;
    const urgency = document.getElementById('quoteUrgency')?.value || 'normal';
    const notes = (document.getElementById('quoteNotes')?.value || '').slice(0, 1000);
    const base = { 'Vector Sigil': 24, 'Miniatura premium': 55, 'Protótipo técnico': 45, 'Badge / chaveiro': 18, 'Peça customizada': 65 }[product] || 45;
    const sizeAdd = { P: 0, M: 18, G: 45, XG: 95 }[size] || 18;
    const materialAdd = { 'PLA': 0, 'PLA+': 8, 'Resina': 22, 'Protótipo econômico': -8 }[material] || 0;
    const finishAdd = { 'Bruto': 0, 'Lixado': 12, 'Pintura simples': 25, 'Pintura premium': 48 }[finish] || 0;
    const urgencyMultiplier = { normal: 1, fast: 1.18, rush: 1.38 }[urgency] || 1;
    const unit = Math.max(10, (base + sizeAdd + materialAdd + finishAdd) * urgencyMultiplier);
    const discount = qty >= 10 ? .86 : qty >= 5 ? .92 : 1;
    const total = Math.round(unit * qty * discount * 100) / 100;
    const daysBase = { P: 1, M: 2, G: 4, XG: 7 }[size] || 2;
    const days = urgency === 'rush' ? Math.max(1, daysBase - 1) : urgency === 'fast' ? Math.max(1, daysBase) : daysBase + 1;
    return { product, size, material, finish, qty, quantityValid, urgency, notes, total, days, unit: Math.round(unit * 100) / 100 };
  }

  function renderQuoteEstimate() {
    const result = calculateQuote();
    if (!result.quantityValid) {
      setText('quotePrice', 'QUANTIDADE INVÁLIDA');
      setText('quoteDeadline', 'Informe uma quantidade inteira entre 1 e 99.');
      setText('quoteSummary', 'A estimativa não será calculada com quantidade fora do intervalo permitido.');
      return;
    }
    setText('quotePrice', formatCurrencyBRL(result.total));
    setText('quoteDeadline', `Prazo estimado: ${result.days} a ${result.days + 2} dias`);
    setText('quoteSummary', `${result.qty}× ${result.product} · ${result.size} · ${result.material} · ${result.finish} · unidade estimada ${formatCurrencyBRL(result.unit)}.`);
  }

  function createQuoteProductionRequest() {
    if (!requirePurchaseValidation()) return;
    showToast('ORÇAMENTO RÁPIDO É APENAS UMA ESTIMATIVA. ENVIE O PEDIDO PELO CATÁLOGO.', 'error');
  }

  function verifyNode() {
    const q = (document.getElementById('verifyInput')?.value || '').trim().toUpperCase();
    const out = document.getElementById('verifyResult');
    if (!out) return;
    if (!q) { out.innerHTML = ''; return; }
    const normalized = normalizeTagInput(q);
    const agent = agents.find(a => a.tag === normalized || String(a.qrId || '').toUpperCase() === q || String(a.qrPayload || '').toUpperCase().includes(q));
    const order = physicalRequests.find(r => String(r.id).toUpperCase() === q || String(r.qrId).toUpperCase() === q || String(r.tag).toUpperCase() === normalized);
    if (agent) {
      out.innerHTML = `<div class="verify-card hud-frame"><span class="hud-corner tl"></span><span class="hud-corner br"></span><p class="eyebrow">// AGENT VERIFIED</p><h2>${escapeHtml(agent.name)}</h2><strong>${escapeHtml(agent.tag)}</strong><div class="verify-grid"><span>Nível</span><b>${escapeHtml(agent.level)}</b><span>Status</span><b>${escapeHtml(agent.status)}</b><span>QR ID</span><b>${escapeHtml(agent.qrId)}</b></div><button class="btn btn-primary btn-sm" data-open-id="${escapeHtml(agent.tag)}" type="button">ABRIR ID DIGITAL</button></div>`;
      out.querySelector('[data-open-id]')?.addEventListener('click', () => openIdCard(agent.tag));
      return;
    }
    if (order) {
      out.innerHTML = `<div class="verify-card hud-frame"><span class="hud-corner tl"></span><span class="hud-corner br"></span><p class="eyebrow">// ORDER VERIFIED</p><h2>${escapeHtml(order.productName)}</h2><strong>${escapeHtml(order.id)}</strong><div class="verify-grid"><span>Cliente</span><b>${escapeHtml(order.name)}</b><span>Status</span><b>${escapeHtml(order.status)}</b><span>Estimativa</span><b>${formatCurrencyBRL(order.estimatedPrice)}</b></div></div>`;
      return;
    }
    out.innerHTML = `<div class="result-denied"><div class="result-denied-title">NÃO VERIFICADO</div><p class="result-denied-sub">Nenhum agente ou pedido encontrado para <strong>${escapeHtml(q)}</strong>.</p></div>`;
  }

  function renderLabGallery() {
    const grid = document.getElementById('labGallery');
    if (!grid) return;
    const products = sortCatalogProducts(getCatalogAdminRecords().filter(product => !product.hidden)).slice(0, 6);
    grid.innerHTML = products.map(p => `<article class="lab-gallery-card hud-frame"><span class="hud-corner tl"></span><span class="hud-corner br"></span><img src="${escapeHtml(p.img)}" alt="${escapeHtml(p.name)}"><div><span>${escapeHtml(p.line)}</span><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p></div></article>`).join('');
  }

  function getAgentOrderHistoryText(tag) {
    const list = physicalRequests.filter(r => r.tag === tag).slice(0, 4);
    if (!list.length) return 'SEM PEDIDOS VINCULADOS';
    return list.map(r => `${r.productName} · ${r.status} · ${formatCurrencyBRL(r.estimatedPrice)}`).join(' | ');
  }

  function downloadAgentSheetPng(tag) {
    const agent = findAgentByTag(tag);
    if (!agent) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 760;
    const ctx = canvas.getContext('2d');
    const red = getComputedStyle(document.body).getPropertyValue('--c-red').trim() || '#E8001C';
    ctx.fillStyle = '#030303'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = red; ctx.lineWidth = 4; ctx.strokeRect(40,40,1120,680);
    ctx.fillStyle = red; ctx.font = '24px Share Tech Mono, monospace'; ctx.fillText('// TRIAXIS AGENT SHEET', 74, 96);
    ctx.fillStyle = '#fff'; ctx.font = '700 54px Orbitron, sans-serif'; ctx.fillText(agent.name.toUpperCase().slice(0, 24), 74, 170);
    ctx.font = '32px Share Tech Mono, monospace'; ctx.fillStyle = red; ctx.fillText(agent.tag, 74, 224);
    ctx.fillStyle = '#888'; ctx.font = '20px Share Tech Mono, monospace';
    const rows = [['Telefone', agent.phone], ['Função', agent.role], ['Nível', agent.level], ['Status', agent.status], ['QR ID', agent.qrId], ['Código', buildInternalCode(agent)], ['Pedidos', getAgentOrderHistoryText(agent.tag)]];
    rows.forEach((r,i)=>{ const y=300+i*52; ctx.fillStyle='#888'; ctx.fillText(r[0].toUpperCase(),74,y); ctx.fillStyle='#fff'; ctx.fillText(String(r[1]).slice(0,64),260,y); });
    if (!drawQrCanvas(ctx, agent, 940, 82, 160)) {
      showToast('QR REAL INDISPONIVEL - EXPORTACAO CANCELADA', 'error');
      return;
    }
    const a=document.createElement('a'); a.download=`triaxis-ficha-${agent.tag.replace('#','')}.png`; a.href=canvas.toDataURL('image/png'); a.click();
    addLog(`FICHA EXPORTADA · ${agent.tag}`); showToast('FICHA DO AGENTE EXPORTADA');
  }

  function downloadProductionOrderPng(requestId) {
    const req = physicalRequests.find(r => r.id === requestId);
    if (!req) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1300; canvas.height = 820;
    const ctx = canvas.getContext('2d');
    const red = getComputedStyle(document.body).getPropertyValue('--c-red').trim() || '#E8001C';
    ctx.fillStyle='#020202'; ctx.fillRect(0,0,1300,820);
    ctx.strokeStyle=red; ctx.lineWidth=4; ctx.strokeRect(44,44,1212,732);
    ctx.fillStyle=red; ctx.font='24px Share Tech Mono, monospace'; ctx.fillText('// ORDEM DE PRODUÇÃO TRIAXIS',78,104);
    ctx.fillStyle='#fff'; ctx.font='700 52px Orbitron, sans-serif'; ctx.fillText(String(req.productName).toUpperCase().slice(0,24),78,178);
    ctx.font='26px Share Tech Mono, monospace'; ctx.fillStyle=red; ctx.fillText(req.id,78,226);
    const rows=[['Cliente',req.name],['Tag',req.tag],['Status',req.status],['Versão',req.productVariantLabel],['Material',req.materialLabel],['Acabamento',req.finishLabel],['Acessório',req.accessoryLabel],['Estimativa',formatCurrencyBRL(req.estimatedPrice)],['Notas',req.notes||'—']];
    ctx.font='20px Share Tech Mono, monospace';
    rows.forEach((r,i)=>{const y=310+i*48;ctx.fillStyle='#888';ctx.fillText(r[0].toUpperCase(),78,y);ctx.fillStyle='#fff';ctx.fillText(String(r[1]).slice(0,66),300,y);});
    ctx.fillStyle='rgba(232,0,28,.08)'; ctx.fillRect(880,260,300,300); ctx.strokeStyle=red; ctx.strokeRect(880,260,300,300);
    ctx.fillStyle='#fff'; ctx.font='700 34px Orbitron, sans-serif'; ctx.textAlign='center'; ctx.fillText('TRIAXIS',1030,410); ctx.fillStyle=red; ctx.font='22px Share Tech Mono, monospace'; ctx.fillText('PRODUCTION NODE',1030,450); ctx.textAlign='left';
    const a=document.createElement('a'); a.download=`triaxis-ordem-${req.id}.png`; a.href=canvas.toDataURL('image/png'); a.click();
    addLog(`ORDEM PNG EXPORTADA · ${req.id}`); showToast('ORDEM DE PRODUÇÃO EXPORTADA');
  }

  function scrollActiveLoginPage(direction) {
    const page = document.querySelector('.login-scroll-page:not([hidden])');
    if (!page) return;
    const amount = Math.max(120, Math.floor(page.clientHeight * 0.72));
    page.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'smooth' });
  }


  /* ── Inicialização ───────────────────────────────────────────────── */
  async function init() {
    if (!await remediateLegacyLocalPii()) return;
    agents = loadAgents();
    validatedPurchaseTag = null;
    loggedAgentTag = null;
    physicalRequests = loadPhysicalIdRequests();
    loadCatalogAdminState();
    const settings = loadSettings();
    settings.mode = 'client';
    applySettings(settings);
    setCurrentTag(generateUniqueTag());

    document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => switchView(btn.getAttribute('data-view'))));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshCatalogFromSupabase();
    });
    document.querySelectorAll('[data-home-go]').forEach((btn) => btn.addEventListener('click', () => handleHomeQuickAccess(btn.getAttribute('data-home-go'))));
    document.getElementById('btnToggleSidebar')?.addEventListener('click', toggleSidebarHidden);
    document.getElementById('btnShowSidebar')?.addEventListener('click', () => setSidebarHidden(false));
    restoreSidebarState();
    document.getElementById('btnGenerate').addEventListener('click', () => { setCurrentTag(generateUniqueTag()); addLog('NOVA TAG TEMPORÁRIA GERADA'); });
    document.getElementById('btnAddProfile').addEventListener('click', openAddProfileModal);

    document.getElementById('formAddProfile').addEventListener('submit', handleAddProfileSubmit);
    document.getElementById('inputPhoto').addEventListener('change', handlePhotoUpload);
    document.getElementById('inputPhone').addEventListener('input', (e) => { e.target.value = maskPhone(e.target.value); });

    const searchInline = document.getElementById('searchInputInline');
    const resultInline = document.getElementById('searchResultInline');
    document.getElementById('btnSearchInline').addEventListener('click', () => performTagSearch(searchInline, resultInline));
    searchInline.addEventListener('keydown', (e) => { if (e.key === 'Enter') performTagSearch(searchInline, resultInline); });

    const searchMain = document.getElementById('searchInputMain');
    document.getElementById('btnSearchMain').addEventListener('click', performAdvancedSearch);
    searchMain.addEventListener('keydown', (e) => { if (e.key === 'Enter') performAdvancedSearch(); });
    document.getElementById('searchStatusFilter').addEventListener('change', performAdvancedSearch);
    document.getElementById('searchLevelFilter').addEventListener('change', performAdvancedSearch);

    document.getElementById('btnSidebarSearch').addEventListener('click', performSidebarSearch);
    document.getElementById('sidebarSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') performSidebarSearch(); });

    ['bankFilterText', 'bankFilterStatus', 'bankFilterLevel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(id === 'bankFilterText' ? 'input' : 'change', renderBank);
    });

    document.getElementById('physicalAgentSelect')?.addEventListener('change', (e) => selectPhysicalAgent(e.target.value));
    document.getElementById('btnPhysicalSearch')?.addEventListener('click', searchPhysicalAgent);
    document.getElementById('physicalAgentSearch')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPhysicalAgent(); });
    document.querySelectorAll('[data-keychain-side]').forEach(btn => btn.addEventListener('click', () => flipPhysicalKeychain(btn.getAttribute('data-keychain-side'))));
    document.getElementById('btnRequestPhysicalFromView')?.addEventListener('click', () => openPhysicalIdModal(currentPhysicalTag));
    document.getElementById('btnDownloadPhysicalPreview')?.addEventListener('click', downloadPhysicalPreviewPng);
    document.getElementById('physicalProductSelect')?.addEventListener('change', (e) => setPhysicalProduct(e.target.value, currentPhysicalVariant));
    document.getElementById('physicalVariantSelect')?.addEventListener('change', (e) => setPhysicalProduct(currentPhysicalProduct, e.target.value));
    document.getElementById('btnCatalogOpenPhysical')?.addEventListener('click', () => switchView('physical'));
    ['catalogSearchInput','catalogCategoryFilter','catalogPriceFilter','catalogTimeFilter','catalogAvailabilityFilter'].forEach(id => document.getElementById(id)?.addEventListener('input', renderCatalog));
    document.getElementById('btnCatalogClearFilters')?.addEventListener('click', () => {
      const search = document.getElementById('catalogSearchInput');
      const category = document.getElementById('catalogCategoryFilter');
      const price = document.getElementById('catalogPriceFilter');
      const time = document.getElementById('catalogTimeFilter');
      const availability = document.getElementById('catalogAvailabilityFilter');
      if (search) search.value = '';
      if (category) category.value = 'all';
      if (price) price.value = 'all';
      if (time) time.value = 'all';
      if (availability) availability.value = 'all';
      renderCatalog();
      showToast('FILTROS DO CATÁLOGO LIMPOS');
    });
    document.getElementById('btnValidatePurchaseTag')?.addEventListener('click', validatePurchaseTag);
    document.getElementById('btnClearPurchaseTag')?.addEventListener('click', clearPurchaseTagValidation);
    document.getElementById('purchaseTagInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') validatePurchaseTag(); });
    document.getElementById('productionFilterText')?.addEventListener('input', renderProduction);
    document.getElementById('productionFilterStatus')?.addEventListener('change', renderProduction);
    ['quoteProduct','quoteSize','quoteMaterial','quoteFinish','quoteQty','quoteUrgency'].forEach(id => document.getElementById(id)?.addEventListener(id === 'quoteQty' ? 'input' : 'change', renderQuoteEstimate));
    document.getElementById('btnQuoteCalc')?.addEventListener('click', renderQuoteEstimate);
    document.getElementById('btnQuoteCreate')?.addEventListener('click', createQuoteProductionRequest);
    document.getElementById('btnVerifyNode')?.addEventListener('click', verifyNode);
    document.getElementById('verifyInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyNode(); });
    document.getElementById('physicalColorSelect')?.addEventListener('change', () => showToast('PERSONALIZAÇÃO ATUALIZADA'));
    document.getElementById('physicalDisplayText')?.addEventListener('input', () => renderPhysicalKeychainPreview(findAgentByTag(currentPhysicalTag), currentPhysicalSide));

    document.querySelectorAll('[data-close-modal]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal'))));
    document.querySelectorAll('.modal-overlay').forEach((overlay) => overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAllModals(); }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

    document.getElementById('btnFlipId').addEventListener('click', flipIdCard);
    document.getElementById('btnRequestPhysicalFromId')?.addEventListener('click', () => openPhysicalIdModal(currentIdTag));
    document.getElementById('btnConfirmPhysicalRequest')?.addEventListener('click', () => requestPhysicalId(currentPhysicalTag || currentIdTag));
    ['physicalMaterialSelect', 'physicalFinishSelect', 'physicalAccessorySelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', updatePhysicalPricePreview);
    });
    document.getElementById('btnDownloadId').addEventListener('click', downloadCurrentIdPng);
    document.getElementById('btnBankModalOpenId')?.addEventListener('click', openIdFromBankModal);
    document.getElementById('btnBankModalRequestPhysical')?.addEventListener('click', requestPhysicalFromBankModal);
    document.getElementById('btnBankModalRemove')?.addEventListener('click', removeAgentFromBankModal);
    document.getElementById('btnBankModalExport')?.addEventListener('click', () => downloadAgentSheetPng(currentIdTag));

    document.getElementById('toggleScanlines').addEventListener('change', (e) => handleSettingsToggle('scanlines', e.target.checked));
    document.getElementById('toggleGlitch').addEventListener('change', (e) => handleSettingsToggle('glitch', e.target.checked));
    document.getElementById('toggleNoise').addEventListener('change', (e) => handleSettingsToggle('noise', e.target.checked));
    document.getElementById('themeSelect').addEventListener('change', (e) => handleSettingsToggle('theme', e.target.value));
    document.getElementById('modeSelect')?.addEventListener('change', (e) => handleSettingsToggle('mode', e.target.value));
    document.getElementById('btnTestMode')?.addEventListener('click', toggleTestMode);
    document.getElementById('btnLoginAccess')?.addEventListener('click', toggleLoginPanel);
    document.getElementById('btnCloseLoginPanel')?.addEventListener('click', closeLoginPanel);
    document.getElementById('formTagLogin')?.addEventListener('submit', handleTagLoginSubmit);
    document.getElementById('formCreateLoginId')?.addEventListener('submit', handleCreateLoginIdSubmit);
    document.getElementById('formPasswordRecovery')?.addEventListener('submit', handlePasswordRecoverySubmit);
    document.getElementById('btnForgotPassword')?.addEventListener('click', requestPasswordRecovery);
    document.querySelectorAll('[data-login-mode]').forEach((btn) => btn.addEventListener('click', () => setLoginMode(btn.getAttribute('data-login-mode'))));
    document.querySelectorAll('[data-login-scroll]').forEach((btn) => btn.addEventListener('click', () => scrollActiveLoginPage(btn.getAttribute('data-login-scroll'))));
    document.getElementById('btnRegenerateLoginTag')?.addEventListener('click', () => {
      updateCreateLoginTagPreview(true);
      setCreateLoginStatus('Novo ID gerado e vinculado ao cadastro.');
    });
    document.getElementById('createLoginPasswordInput')?.addEventListener('input', updateCreateIdPasswordRules);
    document.getElementById('createLoginPhoneInput')?.addEventListener('input', (e) => { e.target.value = maskPhone(e.target.value); });
    document.getElementById('loginPasswordInput')?.addEventListener('input', updateLoginRules);
    document.getElementById('recoveryPasswordInput')?.addEventListener('input', updateRecoveryPasswordRules);
    document.getElementById('recoveryPasswordConfirmInput')?.addEventListener('input', () => {
      if (passwordRecoveryMode) setRecoveryStatus('Informe e confirme sua nova senha.');
    });
    document.getElementById('loginTagInput')?.addEventListener('input', (e) => {
      e.target.value = String(e.target.value || '').trimStart().toLowerCase();
      passwordRecoveryLinkError = false;
      if (!getLoggedAgent()) setLoginStatus('Aguardando credenciais.');
    });
    document.getElementById('btnLogoutAccess')?.addEventListener('click', logoutAccess);
    document.getElementById('btnOpenLoggedProfile')?.addEventListener('click', () => { closeLoginPanel(); switchView('profile'); });
    document.getElementById('btnExportData').addEventListener('click', exportData);
    document.getElementById('inputImportData').addEventListener('change', importData);
    document.getElementById('btnClearData').addEventListener('click', clearDatabase);
    initCatalogAdminControls();

    renderAllDynamic();
    setCatalogPanel('storefront');
    renderLoginState();
    updateLoginRules();

    const passwordRecoveryUrlMarker = hasPasswordRecoveryUrlMarker();
    const passwordRecoveryIntent = capturePasswordRecoveryUrlIntent();
    const passwordRecoveryUrlError = consumePasswordRecoveryUrlError();
    passwordRecoveryUrlProcessing = passwordRecoveryUrlMarker;
    try {
      if (!window.TriAxisAuth) throw new Error('Cliente Supabase não carregado');
      await window.TriAxisAuth.initialize(applyRemoteAuthState, handleRemoteAuthEvent, {
        detectSessionInUrl: !passwordRecoveryUrlMarker
      });
      let passwordRecoveryProcessingError = false;
      let recoveredSession = null;
      if (passwordRecoveryIntent) {
        try {
          let recoveryState = null;
          if (passwordRecoveryIntent.kind === 'token_hash') {
            recoveryState = await window.TriAxisAuth.verifyRecoveryTokenHash(passwordRecoveryIntent.tokenHash);
          } else if (passwordRecoveryIntent.kind === 'code') {
            recoveryState = await window.TriAxisAuth.exchangeRecoveryCode(passwordRecoveryIntent.code);
          } else if (passwordRecoveryIntent.kind === 'implicit') {
            recoveryState = await window.TriAxisAuth.setRecoverySession(
              passwordRecoveryIntent.accessToken,
              passwordRecoveryIntent.refreshToken
            );
          }
          recoveredSession = recoveryState?.session || null;
        } catch (error) {
          passwordRecoveryProcessingError = true;
          console.error('Falha ao validar link de recuperação:', error);
        }
      }
      if (passwordRecoveryUrlMarker) cleanPasswordRecoveryUrlCredentials();
      passwordRecoveryUrlProcessing = false;

      if (passwordRecoveryUrlError || passwordRecoveryProcessingError || (passwordRecoveryUrlMarker && !passwordRecoveryIntent)) {
        showPasswordRecoveryUrlError();
      } else if (passwordRecoveryIntent) {
        if (!passwordRecoveryMode && !enterPasswordRecoveryMode(recoveredSession)) showPasswordRecoveryUrlError();
      }
    } catch (err) {
      console.error('Falha ao iniciar autenticação Supabase:', err);
      passwordRecoveryUrlProcessing = false;
      applyRemoteAuthState({ session: null, profile: null, roles: [] });
      if (passwordRecoveryUrlMarker) cleanPasswordRecoveryUrlCredentials();
      if (passwordRecoveryUrlError || passwordRecoveryUrlMarker) {
        showPasswordRecoveryUrlError();
      } else {
        setLoginStatus('SERVIÇO DE LOGIN TEMPORARIAMENTE INDISPONÍVEL.', 'error');
        showToast('LOGIN ONLINE INDISPONÍVEL', 'error');
      }
    }
  }

  window.TriAxisLegacyMigration = Object.freeze({ run: remediateLegacyLocalPii });
  document.addEventListener('DOMContentLoaded', init);
})();
