-- TriAxis Nexus V4 — sincronização transacional do catálogo
-- Execute depois de 001_initial_schema.sql.

create table if not exists public.catalog_settings (
  id text primary key check (id = 'main'),
  layout jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists catalog_settings_set_updated_at on public.catalog_settings;
create trigger catalog_settings_set_updated_at
before update on public.catalog_settings
for each row execute function public.set_updated_at();

alter table public.catalog_settings enable row level security;

drop policy if exists catalog_settings_public_select on public.catalog_settings;
create policy catalog_settings_public_select on public.catalog_settings
for select to anon, authenticated
using (true);

drop policy if exists catalog_settings_admin_insert on public.catalog_settings;
create policy catalog_settings_admin_insert on public.catalog_settings
for insert to authenticated
with check (public.has_role('admin'));

drop policy if exists catalog_settings_admin_update on public.catalog_settings;
create policy catalog_settings_admin_update on public.catalog_settings
for update to authenticated
using (public.has_role('admin'))
with check (public.has_role('admin'));

insert into public.catalog_settings (id, layout)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

grant select on public.catalog_settings to anon, authenticated;
grant insert, update on public.catalog_settings to authenticated;

create or replace function public.sync_catalog(catalog_data jsonb, layout_data jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  item_metadata jsonb;
  item_customization jsonb;
  item_slug text;
  item_name text;
  item_product_id uuid;
  image_path text;
  image_order integer;
  kept_slugs text[] := array[]::text[];
  product_count integer;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN';
  end if;

  if jsonb_typeof(catalog_data) <> 'array' then
    raise exception 'INVALID_CATALOG';
  end if;

  product_count := jsonb_array_length(catalog_data);
  if product_count < 1 or product_count > 500 then
    raise exception 'INVALID_CATALOG_SIZE';
  end if;

  for item in select value from jsonb_array_elements(catalog_data)
  loop
    item_slug := lower(trim(item ->> 'slug'));
    item_name := trim(item ->> 'name');
    item_metadata := case when jsonb_typeof(item -> 'metadata') = 'object' then item -> 'metadata' else '{}'::jsonb end;
    item_customization := case when jsonb_typeof(item -> 'customization') = 'object' then item -> 'customization' else '{}'::jsonb end;

    if item_slug is null or item_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
      raise exception 'INVALID_PRODUCT_SLUG';
    end if;
    if item_name is null or char_length(item_name) not between 2 and 160 then
      raise exception 'INVALID_PRODUCT_NAME';
    end if;
    if item_slug = any(kept_slugs) then
      raise exception 'DUPLICATE_PRODUCT_SLUG';
    end if;

    insert into public.products (
      slug, name, description, base_price, currency, status, published,
      customization, metadata, created_by
    ) values (
      item_slug,
      item_name,
      coalesce(item ->> 'description', ''),
      greatest(0, coalesce((item ->> 'base_price')::numeric, 0)),
      'BRL',
      case when item ->> 'status' in ('draft', 'active', 'archived')
        then (item ->> 'status')::public.product_status else 'draft'::public.product_status end,
      coalesce((item ->> 'published')::boolean, false),
      item_customization,
      item_metadata,
      auth.uid()
    )
    on conflict (slug) do update set
      name = excluded.name,
      description = excluded.description,
      base_price = excluded.base_price,
      status = excluded.status,
      published = excluded.published,
      customization = excluded.customization,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
    returning id into item_product_id;

    delete from public.product_images where product_id = item_product_id;
    if jsonb_typeof(item_metadata -> 'storage_paths') = 'array' then
      image_order := 0;
      for image_path in select value from jsonb_array_elements_text(item_metadata -> 'storage_paths')
      loop
        image_path := btrim(image_path);
        if image_path ~ '^catalog/[a-z0-9][a-z0-9-]{0,79}/[a-zA-Z0-9_-]{8,80}\.(jpg|jpeg|png|webp|gif)$'
           and image_path not like '%..%'
           and image_path not like '%//%'
           and image_path not like '%\\%'
           and char_length(image_path) <= 180 then
          insert into public.product_images (product_id, storage_path, alt_text, sort_order)
          values (item_product_id, image_path, item_name, image_order)
          on conflict (product_id, storage_path) do nothing;
          image_order := image_order + 1;
        end if;
      end loop;
    end if;

    kept_slugs := array_append(kept_slugs, item_slug);
  end loop;

  delete from public.products where not (slug = any(kept_slugs));

  insert into public.catalog_settings (id, layout, updated_by)
  values ('main', case when jsonb_typeof(layout_data) = 'object' then layout_data else '{}'::jsonb end, auth.uid())
  on conflict (id) do update set
    layout = excluded.layout,
    updated_by = excluded.updated_by,
    updated_at = timezone('utc', now());

  insert into public.audit_events (actor_id, action, entity_type, metadata)
  values (auth.uid(), 'catalog.sync', 'catalog', jsonb_build_object('products', product_count));

  return product_count;
end;
$$;

revoke all on function public.sync_catalog(jsonb, jsonb) from public;
grant execute on function public.sync_catalog(jsonb, jsonb) to authenticated;
