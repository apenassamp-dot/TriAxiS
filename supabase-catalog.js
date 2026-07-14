(function () {
  'use strict';

  const PRODUCT_BUCKET = 'product-images';

  function requireClient() {
    if (!window.TriAxisAuth?.getClient) throw new Error('CATALOG_AUTH_NOT_INITIALIZED');
    return window.TriAxisAuth.getClient();
  }

  function requireAdmin() {
    if (!window.TriAxisAuth?.isAdmin?.()) throw new Error('CATALOG_ADMIN_REQUIRED');
  }

  function toDatabaseSlug(value) {
    const slug = String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    if (!slug) throw new Error('CATALOG_INVALID_SLUG');
    return slug;
  }

  function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function listValue(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function mapRemoteProduct(row) {
    const metadata = objectValue(row.metadata);
    const customization = objectValue(row.customization);
    const gallery = listValue(metadata.gallery);
    const img = String(metadata.img || gallery[0] || 'assets/cybershape-unit.png');
    return {
      id: String(metadata.catalog_id || row.slug || '').replace(/-/g, '_'),
      name: row.name,
      line: metadata.line || 'TRIAXIS PRODUCT',
      img,
      basePrice: Number(row.base_price || 0),
      productionTime: metadata.production_time || 'sob consulta',
      description: row.description || '',
      specs: listValue(customization.specs),
      category: metadata.category || 'services',
      categoryLabel: metadata.category_label || 'Serviços',
      lineLabel: metadata.line_label || 'CUSTOM LAB',
      type: metadata.type || metadata.line || 'ARTEFATO',
      availability: metadata.availability || 'custom_order',
      availabilityLabel: metadata.availability_label || 'Sob encomenda',
      customization: customization.summary || 'Personalização sob consulta',
      size: customization.size || 'Sob consulta',
      materials: listValue(customization.materials),
      uses: listValue(customization.uses),
      gallery: gallery.length ? gallery : [img],
      hidden: !row.published,
      featured: Boolean(metadata.featured),
      priority: Number(metadata.priority || 0),
      promoLabel: metadata.promo_label || '',
      ctaLabel: metadata.cta_label || 'SOLICITAR ARTEFATO',
      cardStyle: metadata.card_style || 'standard',
      accent: metadata.accent || '#E8001C',
      imageFit: metadata.image_fit || 'contain',
      showPrice: metadata.show_price !== false,
      updatedAt: row.updated_at
    };
  }

  function dataImageType(source) {
    const match = String(source || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,/i);
    return match?.[1]?.toLowerCase() || null;
  }

  function storagePathFromPublicUrl(source) {
    const marker = `/storage/v1/object/public/${PRODUCT_BUCKET}/`;
    const value = String(source || '');
    const index = value.indexOf(marker);
    if (index < 0) return null;
    const path = decodeURIComponent(value.slice(index + marker.length));
    return path.startsWith('catalog/') ? path : null;
  }

  async function uploadDataImage(source, slug, index) {
    const contentType = dataImageType(source);
    if (!contentType) return { url: source, path: storagePathFromPublicUrl(source) };
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];
    const response = await fetch(source);
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024) throw new Error('CATALOG_IMAGE_TOO_LARGE');
    const unique = window.crypto?.randomUUID?.() || `${Date.now()}-${index}`;
    const path = `catalog/${slug}/${unique}.${extension}`;
    const api = requireClient();
    const { error } = await api.storage.from(PRODUCT_BUCKET).upload(path, blob, {
      contentType,
      cacheControl: '31536000',
      upsert: false
    });
    if (error) throw error;
    const { data } = api.storage.from(PRODUCT_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('CATALOG_IMAGE_URL_MISSING');
    return { url: data.publicUrl, path };
  }

  async function prepareProduct(record) {
    const slug = toDatabaseSlug(record.id || record.name);
    const sources = Array.from(new Set([record.img, ...(record.gallery || [])].filter(Boolean)));
    const uploaded = new Map();
    for (let index = 0; index < sources.length; index += 1) {
      uploaded.set(sources[index], await uploadDataImage(sources[index], slug, index));
    }
    const gallery = sources.map((source) => uploaded.get(source)?.url || source);
    const img = uploaded.get(record.img)?.url || gallery[0] || 'assets/cybershape-unit.png';
    const storagePaths = sources.map((source) => uploaded.get(source)?.path).filter(Boolean);
    return {
      local: { ...record, img, gallery },
      remote: {
        slug,
        name: String(record.name || '').trim(),
        description: String(record.description || '').trim(),
        base_price: Math.max(0, Number(record.basePrice || 0)),
        status: record.hidden ? 'draft' : 'active',
        published: !record.hidden,
        customization: {
          summary: record.customization || '',
          size: record.size || '',
          specs: listValue(record.specs),
          materials: listValue(record.materials),
          uses: listValue(record.uses)
        },
        metadata: {
          catalog_id: record.id,
          line: record.line,
          img,
          production_time: record.productionTime,
          category: record.category,
          category_label: record.categoryLabel,
          line_label: record.lineLabel,
          type: record.type,
          availability: record.availability,
          availability_label: record.availabilityLabel,
          gallery,
          storage_paths: storagePaths,
          featured: Boolean(record.featured),
          priority: Number(record.priority || 0),
          promo_label: record.promoLabel || '',
          cta_label: record.ctaLabel || '',
          card_style: record.cardStyle || 'standard',
          accent: record.accent || '#E8001C',
          image_fit: record.imageFit || 'contain',
          show_price: record.showPrice !== false
        }
      }
    };
  }

  async function load() {
    const api = requireClient();
    const [productsResult, settingsResult] = await Promise.all([
      api.from('products').select('id, slug, name, description, base_price, status, published, customization, metadata, updated_at'),
      api.from('catalog_settings').select('layout').eq('id', 'main').maybeSingle()
    ]);
    if (productsResult.error) throw productsResult.error;
    if (settingsResult.error) throw settingsResult.error;
    return {
      products: (productsResult.data || []).map(mapRemoteProduct).sort((a, b) => a.priority - b.priority),
      layout: settingsResult.data?.layout || null
    };
  }

  async function sync(state) {
    requireAdmin();
    if (!Array.isArray(state?.products) || !state.products.length) throw new Error('CATALOG_EMPTY');
    const prepared = [];
    for (const product of state.products) prepared.push(await prepareProduct(product));
    const api = requireClient();
    const { error } = await api.rpc('sync_catalog', {
      catalog_data: prepared.map((item) => item.remote),
      layout_data: objectValue(state.layout)
    });
    if (error) throw error;
    return {
      products: prepared.map((item) => item.local),
      layout: state.layout
    };
  }

  window.TriAxisCatalog = Object.freeze({ load, sync });
})();
