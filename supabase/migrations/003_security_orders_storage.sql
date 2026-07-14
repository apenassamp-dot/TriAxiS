-- TriAxis Nexus V4 — hardening incremental de acesso, pedidos e imagens.
-- Aplicar depois de 001_initial_schema.sql e 002_catalog_sync.sql.

create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles r
    join public.profiles p on p.id = r.user_id and p.status = 'active'
    where r.user_id = auth.uid() and r.role = required_role
  );
$$;

revoke all on function public.is_active_profile() from public;
grant execute on function public.is_active_profile() to anon, authenticated;

alter table public.orders
  add column if not exists idempotency_key uuid;

create unique index if not exists orders_customer_idempotency_idx
  on public.orders (customer_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.submit_order(
  requested_product_id uuid,
  requested_quantity integer,
  requested_configuration jsonb,
  requested_notes text,
  requested_idempotency_key uuid
)
returns table (order_id uuid, order_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_product public.products%rowtype;
  created_order public.orders%rowtype;
  config_entry record;
  calculated_total numeric(12,2);
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception 'PROFILE_NOT_ACTIVE';
  end if;
  if requested_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select * into created_order
  from public.orders
  where customer_id = auth.uid() and idempotency_key = requested_idempotency_key;
  if found then
    return query select created_order.id, created_order.order_code;
    return;
  end if;

  if requested_quantity is null or requested_quantity < 1 or requested_quantity > 99 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if requested_configuration is null or jsonb_typeof(requested_configuration) <> 'object' then
    raise exception 'INVALID_CONFIGURATION';
  end if;
  if octet_length(requested_configuration::text) > 4096 or (
    select count(*) from jsonb_object_keys(requested_configuration)
  ) > 12 then
    raise exception 'CONFIGURATION_TOO_LARGE';
  end if;
  for config_entry in select key, value from jsonb_each(requested_configuration)
  loop
    if config_entry.key not in (
      'variant', 'material', 'finish', 'accessory', 'color_main', 'color_accent',
      'origin', 'deadline'
    ) or config_entry.key !~ '^[a-z][a-z0-9_]{0,31}$' then
      raise exception 'INVALID_CONFIGURATION_KEY';
    end if;
    if jsonb_typeof(config_entry.value) <> 'string'
      or char_length(config_entry.value #>> '{}') > 120
      or config_entry.value #>> '{}' ~ '[[:cntrl:]]' then
      raise exception 'INVALID_CONFIGURATION_VALUE';
    end if;
  end loop;
  if char_length(coalesce(requested_notes, '')) > 1000 then
    raise exception 'NOTES_TOO_LARGE';
  end if;
  if (
    select count(*) from public.orders
    where customer_id = auth.uid()
      and submitted_at > timezone('utc', now()) - interval '10 minutes'
  ) >= 10 then
    raise exception 'ORDER_RATE_LIMITED';
  end if;

  select * into selected_product
  from public.products
  where id = requested_product_id and published = true and status = 'active'
  for share;
  if not found then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  calculated_total := selected_product.base_price * requested_quantity;
  insert into public.orders (
    customer_id, idempotency_key, subtotal, total, customer_notes
  ) values (
    auth.uid(), requested_idempotency_key, calculated_total, calculated_total,
    coalesce(requested_notes, '')
  ) returning * into created_order;

  insert into public.order_items (
    order_id, product_id, product_snapshot, quantity, configuration, unit_price, line_total
  ) values (
    created_order.id,
    selected_product.id,
    jsonb_build_object(
      'id', selected_product.id,
      'slug', selected_product.slug,
      'name', selected_product.name,
      'base_price', selected_product.base_price,
      'currency', selected_product.currency
    ),
    requested_quantity,
    requested_configuration,
    selected_product.base_price,
    calculated_total
  );

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (created_order.id, null, 'submitted', auth.uid(), 'Pedido enviado pelo cliente.');
  insert into public.audit_events (actor_id, action, entity_type, entity_id)
  values (auth.uid(), 'order.submitted', 'order', created_order.id);

  return query select created_order.id, created_order.order_code;
end;
$$;

-- Bloqueia clientes antigos que ainda tentem chamar a assinatura sem idempotência.
create or replace function public.submit_order(
  requested_product_id uuid,
  requested_quantity integer,
  requested_configuration jsonb default '{}'::jsonb,
  requested_notes text default ''
)
returns table (order_id uuid, order_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'CLIENT_UPGRADE_REQUIRED';
end;
$$;

revoke all on function public.submit_order(uuid, integer, jsonb, text) from public;
revoke all on function public.submit_order(uuid, integer, jsonb, text, uuid) from public;
grant execute on function public.submit_order(uuid, integer, jsonb, text, uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (public.is_active_profile() and (id = auth.uid() or public.is_staff()));

drop policy if exists roles_select on public.user_roles;
create policy roles_select on public.user_roles for select to authenticated
using (public.is_active_profile() and (user_id = auth.uid() or public.has_role('admin')));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
using (public.is_active_profile() and (customer_id = auth.uid() or public.is_staff()));

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
using (
  public.is_active_profile() and exists (
    select 1 from public.orders o
    where o.id = order_id and (o.customer_id = auth.uid() or public.is_staff())
  )
);

drop policy if exists order_history_select on public.order_status_history;
create policy order_history_select on public.order_status_history for select to authenticated
using (
  public.is_active_profile() and exists (
    select 1 from public.orders o
    where o.id = order_id and (o.customer_id = auth.uid() or public.is_staff())
  )
);

drop policy if exists audit_admin_select on public.audit_events;
create policy audit_admin_select on public.audit_events for select to authenticated
using (public.has_role('admin'));

-- O bucket deixa de servir qualquer objeto por URL pública. A leitura passa por RLS e URL assinada.
update storage.buckets set public = false where id = 'product-images';

drop policy if exists product_images_public_read on storage.objects;
drop policy if exists product_images_published_read on storage.objects;
drop policy if exists product_images_admin_read on storage.objects;
create policy product_images_published_read on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'product-images' and exists (
    select 1
    from public.product_images pi
    join public.products p on p.id = pi.product_id
    where pi.storage_path = name
      and p.published = true and p.status = 'active'
  )
);

-- O administrador precisa ler o upload privado antes de sync_catalog criar o vínculo.
-- Esta política nunca é concedida a anon e has_role exige perfil ativo.
create policy product_images_admin_read on storage.objects
for select to authenticated
using (bucket_id = 'product-images' and public.has_role('admin'));

drop policy if exists avatars_owner_or_staff_read on storage.objects;
create policy avatars_owner_or_staff_read on storage.objects for select to authenticated
using (
  public.is_active_profile() and bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
);

drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects for insert to authenticated
with check (
  public.is_active_profile() and bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects for update to authenticated
using (
  public.is_active_profile() and bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  public.is_active_profile() and bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects for delete to authenticated
using (
  public.is_active_profile() and bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
