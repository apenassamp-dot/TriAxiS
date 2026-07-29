# Supabase — TriAxis Nexus V4

Esta pasta contém as migrações versionadas do banco do MVP.

## Aplicar a primeira migração

1. Abra o projeto no painel do Supabase.
2. Entre em **SQL Editor**.
3. Clique em **New query**.
4. Copie todo o conteúdo de `migrations/001_initial_schema.sql`.
5. Cole no editor e clique em **Run**.
6. Confirme que a execução terminou sem erros antes de continuar.

## Aplicar a migração do catálogo

Depois da migração inicial:

1. Abra uma nova consulta no **SQL Editor**.
2. Copie todo o conteúdo de `migrations/002_catalog_sync.sql`.
3. Cole no editor e clique em **Run**.
4. Confirme que a execução terminou sem erros.

Essa migração cria a configuração compartilhada da vitrine e a função
transacional usada pelo painel para sincronizar produtos. Quando um usuário com
papel `admin` entrar e o banco ainda estiver sem produtos, o catálogo inicial é
importado automaticamente, sem duplicar registros.

Não coloque no repositório a senha do banco, a `service_role` key ou tokens pessoais.

## O que a migração cria

- perfis vinculados a `auth.users`;
- papéis `customer`, `production`, `support` e `admin`;
- catálogo e imagens;
- pedidos, itens e histórico de estados;
- eventos de auditoria;
- políticas RLS;
- funções protegidas para enviar pedido, mudar estado e atribuir papel;
- buckets `product-images` e `avatars`.

## Primeiro administrador

Depois que a autenticação do frontend estiver conectada:

1. Crie a conta que será administradora pelo formulário normal.
2. Localize o usuário em **Authentication > Users** e copie seu UUID.
3. Execute no SQL Editor, substituindo o UUID:

```sql
insert into public.user_roles (user_id, role)
values ('UUID-DO-USUARIO', 'admin')
on conflict (user_id, role) do nothing;
```

Essa promoção inicial deve ser feita no painel do projeto. Depois dela, outros
papéis podem ser administrados pela função protegida `set_user_role`.

## Validar a migração do catálogo

1. Entre no site com a conta administradora.
2. Aguarde a mensagem `CATÁLOGO INICIAL MIGRADO PARA O SUPABASE`.
3. Em **Table Editor > products**, confirme que os produtos foram criados.
4. Altere um produto no painel e abra o site em outro navegador.
5. Confirme que a alteração aparece no segundo navegador.

Imagens já distribuídas em `assets/` continuam sendo usadas pelo site. Depois da
migração 003, novas imagens ficam no bucket privado `product-images` e são lidas
por URL assinada somente quando pertencem a produto publicado ou por admin ativo.

## Hardening 003

Depois das migrações 001 e 002, execute `migrations/003_security_orders_storage.sql`
uma única vez no SQL Editor. Ela não apaga pedidos nem imagens e adiciona:

- bloqueio de papéis e dados protegidos para perfil suspenso;
- pedidos autoritativos no banco, com idempotência, limites e rate limit;
- criação do pedido e item na mesma transação;
- bucket de produtos privado e leitura alinhada à publicação do produto.

## Política de senha no painel

A política do Supabase Auth não é controlada por migration SQL. Em
**Authentication > Providers > Email > Password security**, configure no mínimo
12 caracteres e, quando disponível no plano, proteção contra senhas vazadas.
Mantenha confirmação de e-mail habilitada. Não considere isso aplicado antes de
salvar e confirmar a configuração no painel.

## Protocolo Operacional v1 — migration 004

Depois da migration 003, execute `migrations/004_operational_protocol_v1.sql`.
Ela preserva os estados legados para compatibilidade e adiciona o fluxo operacional
centralizado, com:

- estados normais e de exceção do pedido;
- papéis separados para comercial, financeiro, operação, produção, logística e suporte;
- preço autoritativo no servidor, incluindo variante, material, acabamento e acessório;
- comprovante único, validação financeira e confirmação de capacidade antes da produção;
- prazo, entrega, rastreio, responsáveis e histórico central com motivo obrigatório;
- bloqueio do RPC legado que permitia mudar status sem os gates do protocolo.

Use `set_operational_role(UUID, PAPEL, true)` com uma conta `admin` para atribuir
os novos papéis. Os valores aceitos são `commercial`, `finance`, `operations`,
`production`, `logistics` e `support`.

Antes do beta, rode `tests/004_operational_protocol_v1_harness.sql` em um projeto
Supabase isolado, depois das migrations 004 e 005. Preencha os UUIDs QA indicados
no início do arquivo, incluindo dois atores financeiros e dois logísticos. O
harness cobre os dez cenários obrigatórios, os gates adicionais da 005 e termina
com `ROLLBACK`.

## Segregação de atores e evidência de reembolso — migration 005

Depois da migration 004, execute
`migrations/005_actor_separation_refund_evidence.sql`.

A migration mantém contas multipapel, mas impede que o mesmo usuário execute
etapas críticas consecutivas do mesmo pedido: recebimento/validação do pagamento,
validação/aprovação, aprovação/produção, produção/expedição,
expedição/entrega e solicitação/processamento do reembolso.

Para solicitar reembolso, informe valor e destinatário. Para concluir, outro ator
financeiro deve registrar referência única e data de processamento.

## Pagamento seguro por provedor — migration 006

Depois da migration 005, execute
`migrations/006_payment_provider_security.sql` somente no projeto QA.

A migration 006 substitui a comprovação manual por um ledger do Mercado Pago,
bloqueia a conclusão manual de pagamento/reembolso e restringe os campos
financeiros legados. O retorno do navegador é apenas informativo: somente um
webhook assinado, seguido de consulta à API do Mercado Pago, pode atualizar o
pedido para `payment_received`.

As Edge Functions ficam em `supabase/functions/`:

- `create-mercadopago-preference`: checkout autenticado e preço autoritativo;
- `mercadopago-webhook`: assinatura, anti-replay e reconsulta do pagamento;
- `request-mercadopago-refund`: reembolso com AAL2 e maker-checker;
- `reconcile-mercadopago-payments`: reconciliação interna.

Configure os segredos no Supabase, nunca em arquivos versionados:

```text
MP_ACCESS_TOKEN=<credencial de teste>
MP_WEBHOOK_SECRET=<segredo do webhook de teste>
MP_COLLECTOR_ID=<id da conta de teste recebedora>
PAYMENTS_ENVIRONMENT=test
PAYMENTS_PRODUCTION_ENABLED=false
PAYMENTS_ALLOWED_ORIGINS=https://apenassamp-dot.github.io
PUBLIC_SITE_URL=https://apenassamp-dot.github.io/TriAxiS
PAYMENTS_REQUIRE_AAL2=true
PAYMENTS_RECONCILIATION_SECRET=<segredo aleatório forte>
```

No painel do Mercado Pago de teste, aponte notificações para:

```text
https://<project-ref>.supabase.co/functions/v1/mercadopago-webhook?source_news=webhooks
```

Depois da 006, aplique também as migrations 007 e 008. A 007 atualiza os
hosts oficiais de checkout do Mercado Pago Brasil; a 008 separa a intenção
idempotente do cliente da chave de cada tentativa enviada ao provedor.

Antes de qualquer credencial real:

1. rode `tests/006_payment_security_harness.sql` no QA;
2. rode também `tests/008_payment_retry_harness.sql` no QA;
3. rode `deno test supabase/functions/tests/*.test.ts`;
4. valide pagamento aprovado, pendente, rejeitado, duplicado e fora de ordem;
5. valide reembolso com dois atores financeiros e MFA/AAL2;
6. configure reconciliação periódica e alertas;
7. faça nova revisão Atlas + Janus;
8. somente com GO explícito altere `PAYMENTS_ENVIRONMENT=production`,
   `PAYMENTS_PRODUCTION_ENABLED=true` e use credenciais de produção.

Não aplique a migration 006 em produção antes de as Edge Functions estarem
publicadas e os testes de QA passarem. O harness 004/005 testa o protocolo anterior
e não deve ser usado para autorizar comprovação manual depois da migration 006.

### Rollback da 004

Em caso de reversão, faça backup, execute
`rollback/004_operational_protocol_v1_rollback.sql` e reaplique imediatamente a
migration 003. O rollback arquiva os dados v1 em
`protocol_v1_rollback_archive` antes de remover as estruturas novas; não o execute
em produção sem janela de manutenção e validação da restauração.
