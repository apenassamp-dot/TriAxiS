-- Harness do Protocolo Operacional v1 (10 cenários obrigatórios).
-- Executar somente em projeto Supabase isolado, depois da migration 004.
-- Preencha as configurações abaixo com contas QA ativas e um produto publicado.
-- O ROLLBACK final impede persistência dos pedidos e papéis de teste.

begin;

-- Exemplo (substitua e descomente):
-- set local triaxis.qa_admin = '00000000-0000-0000-0000-000000000001';
-- set local triaxis.qa_customer = '00000000-0000-0000-0000-000000000002';
-- set local triaxis.qa_commercial = '00000000-0000-0000-0000-000000000003';
-- set local triaxis.qa_finance = '00000000-0000-0000-0000-000000000004';
-- set local triaxis.qa_operations = '00000000-0000-0000-0000-000000000005';
-- set local triaxis.qa_production = '00000000-0000-0000-0000-000000000006';
-- set local triaxis.qa_logistics = '00000000-0000-0000-0000-000000000007';
-- set local triaxis.qa_support = '00000000-0000-0000-0000-000000000008';
-- set local triaxis.qa_product = '00000000-0000-0000-0000-000000000009';

create or replace function pg_temp.qa_uuid(setting_name text)
returns uuid language plpgsql as $$
declare value text := nullif(current_setting(setting_name, true), '');
begin
  if value is null then raise exception 'QA_SETTING_REQUIRED: %', setting_name; end if;
  return value::uuid;
end;
$$;

create or replace function pg_temp.as_user(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'ASSERT_FAILED: %', message; end if;
end;
$$;

do $$
declare
  admin_id uuid := pg_temp.qa_uuid('triaxis.qa_admin');
  commercial_id uuid := pg_temp.qa_uuid('triaxis.qa_commercial');
  finance_id uuid := pg_temp.qa_uuid('triaxis.qa_finance');
  operations_id uuid := pg_temp.qa_uuid('triaxis.qa_operations');
  production_id uuid := pg_temp.qa_uuid('triaxis.qa_production');
  logistics_id uuid := pg_temp.qa_uuid('triaxis.qa_logistics');
  support_id uuid := pg_temp.qa_uuid('triaxis.qa_support');
begin
  perform pg_temp.as_user(admin_id);
  perform public.set_operational_role(commercial_id, 'commercial', true);
  perform public.set_operational_role(finance_id, 'finance', true);
  perform public.set_operational_role(operations_id, 'operations', true);
  perform public.set_operational_role(production_id, 'production', true);
  perform public.set_operational_role(logistics_id, 'logistics', true);
  perform public.set_operational_role(support_id, 'support', true);
end;
$$;

create or replace function pg_temp.new_order(intent_key uuid)
returns uuid language plpgsql as $$
declare result_id uuid;
begin
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_customer'));
  select order_id into result_id from public.submit_order(
    pg_temp.qa_uuid('triaxis.qa_product'), 1,
    '{"variant":"standard","material":"pla_fosco","finish":"simples","accessory":"ball_chain","origin":"qa"}'::jsonb,
    'Pedido QA — migration 004', intent_key
  );
  return result_id;
end;
$$;

create or replace function pg_temp.to_approved(order_id uuid, payment_reference text)
returns void language plpgsql as $$
declare expected_total numeric;
begin
  select total into expected_total from public.orders where id = order_id;
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_commercial'));
  perform public.transition_order_v1(order_id, 'awaiting_payment', 'Cobrança QA iniciada.', '{}');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_finance'));
  perform public.transition_order_v1(order_id, 'payment_received', 'Comprovação QA recebida.',
    jsonb_build_object('payment_method','pix','payment_reference',payment_reference,
      'payment_payer','Cliente QA','payment_amount',expected_total));
  perform public.transition_order_v1(order_id, 'payment_validation', 'Pagamento QA validado.', '{}');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_operations'));
  perform public.transition_order_v1(order_id, 'approved_for_production', 'Capacidade QA confirmada.',
    '{"capacity_confirmed":true}'::jsonb);
end;
$$;

do $$
declare
  normal_order uuid := pg_temp.new_order(gen_random_uuid());
  invalid_proof_order uuid := pg_temp.new_order(gen_random_uuid());
  wrong_amount_order uuid := pg_temp.new_order(gen_random_uuid());
  duplicate_a uuid := pg_temp.new_order(gen_random_uuid());
  duplicate_b uuid := pg_temp.new_order(gen_random_uuid());
  cancel_before uuid := pg_temp.new_order(gen_random_uuid());
  cancel_during uuid := pg_temp.new_order(gen_random_uuid());
  revised_order uuid := pg_temp.new_order(gen_random_uuid());
  defect_order uuid := pg_temp.new_order(gen_random_uuid());
  unauthorized_order uuid := pg_temp.new_order(gen_random_uuid());
  expected_total numeric;
  history_count integer;
begin
  -- 1. Pedido normal até a entrega.
  perform pg_temp.to_approved(normal_order, 'QA-NORMAL-001');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_production'));
  perform public.transition_order_v1(normal_order, 'in_production', 'Produção QA iniciada.',
    jsonb_build_object('production_due_at', timezone('utc', now()) + interval '7 days'));
  perform public.transition_order_v1(normal_order, 'ready', 'Produto QA inspecionado.', '{}');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_logistics'));
  perform public.transition_order_v1(normal_order, 'shipped', 'Pedido QA despachado.',
    '{"delivery_method":"transportadora","tracking_code":"QA-TRACK-001","delivery_details":{"city":"QA"}}');
  perform public.transition_order_v1(normal_order, 'delivered', 'Recebimento QA confirmado.', '{}');
  perform pg_temp.assert_true((select operational_status = 'delivered' from public.orders where id = normal_order), '1 normal até entrega');

  -- 2. Comprovação inválida.
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_commercial'));
  perform public.transition_order_v1(invalid_proof_order, 'awaiting_payment', 'Cobrança QA criada.', '{}');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_finance'));
  begin
    perform public.transition_order_v1(invalid_proof_order, 'payment_received', 'Comprovação inválida QA.', '{"payment_method":"pix"}');
    raise exception 'ASSERT_FAILED: 2 comprovação inválida aceita';
  exception when others then
    if sqlerrm like 'ASSERT_FAILED:%' then raise; end if;
    perform pg_temp.assert_true(sqlerrm like '%PAYMENT_DATA_REQUIRED%', '2 erro de comprovação inválida');
  end;

  -- 3. Valor incorreto.
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_commercial'));
  perform public.transition_order_v1(wrong_amount_order, 'awaiting_payment', 'Cobrança QA criada.', '{}');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_finance'));
  perform public.transition_order_v1(wrong_amount_order, 'payment_received', 'Valor divergente recebido.',
    '{"payment_method":"pix","payment_reference":"QA-WRONG-001","payment_payer":"Cliente QA","payment_amount":0.01}');
  begin
    perform public.transition_order_v1(wrong_amount_order, 'payment_validation', 'Tentativa de validar valor divergente.', '{}');
    raise exception 'ASSERT_FAILED: 3 valor incorreto aceito';
  exception when others then
    if sqlerrm like 'ASSERT_FAILED:%' then raise; end if;
    perform pg_temp.assert_true(sqlerrm like '%PAYMENT_AMOUNT_MISMATCH%', '3 bloqueio de valor divergente');
  end;

  -- 4. Pagamento duplicado.
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_commercial'));
  perform public.transition_order_v1(duplicate_a, 'awaiting_payment', 'Cobrança A criada.', '{}');
  perform public.transition_order_v1(duplicate_b, 'awaiting_payment', 'Cobrança B criada.', '{}');
  select total into expected_total from public.orders where id = duplicate_a;
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_finance'));
  perform public.transition_order_v1(duplicate_a, 'payment_received', 'Primeira comprovação recebida.',
    jsonb_build_object('payment_method','pix','payment_reference','QA-DUP-001','payment_payer','Cliente QA','payment_amount',expected_total));
  begin
    perform public.transition_order_v1(duplicate_b, 'payment_received', 'Comprovação duplicada recebida.',
      jsonb_build_object('payment_method','pix','payment_reference','QA-DUP-001','payment_payer','Cliente QA','payment_amount',expected_total));
    raise exception 'ASSERT_FAILED: 4 pagamento duplicado aceito';
  exception when others then
    if sqlerrm like 'ASSERT_FAILED:%' then raise; end if;
    perform pg_temp.assert_true(sqlerrm like '%PAYMENT_REFERENCE_ALREADY_USED%', '4 bloqueio de duplicidade');
  end;

  -- 5. Cancelamento antes da produção.
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_commercial'));
  perform public.transition_order_v1(cancel_before, 'cancelled', 'Cliente desistiu antes da produção.', '{}');
  perform pg_temp.assert_true((select operational_status = 'cancelled' from public.orders where id = cancel_before), '5 cancelamento antes');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_customer'));
  begin
    perform public.revise_order_configuration_v1(cancel_before,
      '{"variant":"blackout","material":"resina","finish":"premium","accessory":"mosquetao","origin":"qa"}',
      'Tentativa de reativar pedido cancelado.');
    raise exception 'ASSERT_FAILED: 5 pedido cancelado reativado por revisão';
  exception when others then
    if sqlerrm like 'ASSERT_FAILED:%' then raise; end if;
    perform pg_temp.assert_true(sqlerrm like '%SPECIFICATION_REVISION_NOT_ALLOWED%', '5 cancelamento permanece terminal');
  end;

  -- 6. Cancelamento durante a produção exige decisão explícita.
  perform pg_temp.to_approved(cancel_during, 'QA-CANCEL-PROD-001');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_production'));
  perform public.transition_order_v1(cancel_during, 'in_production', 'Produção QA iniciada.',
    jsonb_build_object('production_due_at', timezone('utc', now()) + interval '7 days'));
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_operations'));
  begin
    perform public.transition_order_v1(cancel_during, 'cancelled', 'Cancelamento solicitado durante produção.', '{}');
    raise exception 'ASSERT_FAILED: 6 cancelamento sem decisão aceito';
  exception when others then
    if sqlerrm like 'ASSERT_FAILED:%' then raise; end if;
    perform pg_temp.assert_true(sqlerrm like '%CANCELLATION_DECISION_REQUIRED%', '6 decisão exigida');
  end;
  perform public.transition_order_v1(cancel_during, 'cancelled', 'Cancelamento excepcional aprovado.', '{"decision_reference":"QA-DEC-001"}');

  -- 7. Alteração após aprovação recalcula e exige nova revisão.
  perform pg_temp.to_approved(revised_order, 'QA-REVISE-001');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_customer'));
  perform public.revise_order_configuration_v1(revised_order,
    '{"variant":"blackout","material":"resina","finish":"premium","accessory":"mosquetao","origin":"qa"}',
    'Cliente alterou a configuração aprovada.');
  perform pg_temp.assert_true((select operational_status = 'payment_validation' and approved_at is null and specification_revision = 2
    from public.orders where id = revised_order), '7 revisão de preço/prazo');

  -- 8. Atraso/defeito mantém histórico e permite suspensão/retrabalho.
  perform pg_temp.to_approved(defect_order, 'QA-DEFECT-001');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_production'));
  perform public.transition_order_v1(defect_order, 'in_production', 'Produção QA iniciada.',
    jsonb_build_object('production_due_at', timezone('utc', now()) + interval '7 days'));
  perform public.transition_order_v1(defect_order, 'production_suspended', 'Defeito detectado; retrabalho necessário.', '{}');
  perform pg_temp.assert_true((select operational_status = 'production_suspended' and exception_reason <> '' from public.orders where id = defect_order), '8 suspensão por defeito');

  -- 9. Usuário sem permissão não aprova pagamento.
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_commercial'));
  perform public.transition_order_v1(unauthorized_order, 'awaiting_payment', 'Cobrança QA criada.', '{}');
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_production'));
  begin
    perform public.transition_order_v1(unauthorized_order, 'payment_received', 'Produção tentou validar pagamento.',
      '{"payment_method":"pix","payment_reference":"QA-FORBIDDEN-001","payment_payer":"Cliente QA","payment_amount":1}');
    raise exception 'ASSERT_FAILED: 9 usuário sem permissão aprovou';
  exception when others then
    if sqlerrm like 'ASSERT_FAILED:%' then raise; end if;
    perform pg_temp.assert_true(sqlerrm like '%FORBIDDEN_FOR_TRANSITION%', '9 segregação de papéis');
  end;

  -- 10. Troca de sessão/dispositivo: pedido e histórico permanecem centrais.
  perform pg_temp.as_user(pg_temp.qa_uuid('triaxis.qa_customer'));
  select count(*) into history_count from public.order_operational_history where order_id = normal_order;
  perform pg_temp.assert_true((select operational_status = 'delivered' from public.orders where id = normal_order) and history_count >= 9,
    '10 persistência central após troca de sessão');

  raise notice 'PROTOCOLO_V1_HARNESS_OK: 10/10 cenários aprovados; rollback será executado.';
end;
$$;

rollback;
