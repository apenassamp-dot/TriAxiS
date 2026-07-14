(function () {
  'use strict';

  const PRODUCT_BUCKET = 'product-images';
  const SIGNED_URL_TTL_SECONDS = 3600;
  const SIGNED_URL_REFRESH_MS = 45 * 60 * 1000;

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

  function mapRemoteProduct(row, signedImages = []) {
    const metadata = objectValue(row.metadata);
    const customization = objectValue(row.customization);
    const storedGallery = listValue(metadata.gallery).filter((source) => !storagePathFromPublicUrl(source));
    const gallery = [...signedImages, ...storedGallery];
    const img = String(signedImages[0] || metadata.img || gallery[0] || 'assets/cybershape-unit.png');
    return {
      remoteId: row.id,
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
    if (String(source || '').startsWith('storage://')) return String(source).slice('storage://'.length);
    const marker = `/storage/v1/object/public/${PRODUCT_BUCKET}/`;
    const signedMarker = `/storage/v1/object/sign/${PRODUCT_BUCKET}/`;
    const value = String(source || '');
    const index = value.includes(marker) ? value.indexOf(marker) : value.indexOf(signedMarker);
    if (index < 0) return null;
    const activeMarker = value.includes(marker) ? marker : signedMarker;
    const path = decodeURIComponent(value.slice(index + activeMarker.length).split('?')[0]);
    return path.startsWith('catalog/') ? path : null;
  }

  async function removeUnlinkedUploads(paths) {
    const candidates = Array.from(new Set(paths.filter(Boolean)));
    if (!candidates.length) return;
    const api = requireClient();
    const { data, error } = await api.from('product_images').select('storage_path').in('storage_path', candidates);
    if (error) {
      console.error('Cleanup adiado: não foi possível confirmar vínculos das imagens:', error);
      return;
    }
    const linked = new Set((data || []).map((row) => row.storage_path));
    const orphanPaths = candidates.filter((path) => !linked.has(path));
    if (!orphanPaths.length) return;
    const { error: cleanupError } = await api.storage.from(PRODUCT_BUCKET).remove(orphanPaths);
    if (cleanupError) console.error('Falha ao remover uploads órfãos do catálogo:', cleanupError);
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
    const { data, error: signedError } = await api.storage.from(PRODUCT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signedError || !data?.signedUrl) {
      await api.storage.from(PRODUCT_BUCKET).remove([path]).catch(() => {});
      throw signedError || new Error('CATALOG_IMAGE_URL_MISSING');
    }
    return { url: data.signedUrl, path, uploaded: true };
  }

  async function prepareProduct(record) {
    const slug = toDatabaseSlug(record.id || record.name);
    const sources = Array.from(new Set([record.img, ...(record.gallery || [])].filter(Boolean)));
    const uploaded = new Map();
    try {
      for (let index = 0; index < sources.length; index += 1) {
        uploaded.set(sources[index], await uploadDataImage(sources[index], slug, index));
      }
    } catch (error) {
      const orphanPaths = Array.from(uploaded.values()).filter((item) => item?.uploaded).map((item) => item.path);
      await removeUnlinkedUploads(orphanPaths);
      throw error;
    }
    const gallery = sources.map((source) => uploaded.get(source)?.url || source);
    const img = uploaded.get(record.img)?.url || gallery[0] || 'assets/cybershape-unit.png';
    const storagePaths = sources.map((source) => uploaded.get(source)?.path).filter(Boolean);
    const uploadedPaths = sources.map((source) => uploaded.get(source)).filter((item) => item?.uploaded).map((item) => item.path);
    return {
      local: { ...record, img, gallery },
      uploadedPaths,
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
      api.from('products').select('id, slug, name, description, base_price, status, published, customization, metadata, updated_at, product_images(storage_path, sort_order)'),
      api.from('catalog_settings').select('layout').eq('id', 'main').maybeSingle()
    ]);
    if (productsResult.error) throw productsResult.error;
    if (settingsResult.error) throw settingsResult.error;
    return {
      products: await Promise.all((productsResult.data || []).map(async (row) => {
        const paths = listValue(row.product_images).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
        const signedImages = [];
        for (const image of paths) {
          const { data, error } = await api.storage.from(PRODUCT_BUCKET).createSignedUrl(image.storage_path, SIGNED_URL_TTL_SECONDS);
          if (error) throw error;
          if (data?.signedUrl) signedImages.push(data.signedUrl);
        }
        return mapRemoteProduct(row, signedImages);
      })).then((products) => products.sort((a, b) => a.priority - b.priority)),
      layout: settingsResult.data?.layout || null
    };
  }

  async function sync(state) {
    requireAdmin();
    if (!Array.isArray(state?.products) || !state.products.length) throw new Error('CATALOG_EMPTY');
    const prepared = [];
    const api = requireClient();
    try {
      for (const product of state.products) prepared.push(await prepareProduct(product));
      const { error } = await api.rpc('sync_catalog', {
        catalog_data: prepared.map((item) => item.remote),
        layout_data: objectValue(state.layout)
      });
      if (error) throw error;
      return {
        products: prepared.map((item) => item.local),
        layout: state.layout
      };
    } catch (error) {
      const orphanPaths = prepared.flatMap((item) => item.uploadedPaths || []);
      await removeUnlinkedUploads(orphanPaths);
      throw error;
    }
  }

  window.TriAxisCatalog = Object.freeze({ load, sync, signedUrlRefreshMs: SIGNED_URL_REFRESH_MS });
})();
