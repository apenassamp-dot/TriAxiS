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

Imagens já distribuídas em `assets/` continuam sendo usadas pelo site. Novas
imagens enviadas pelo editor são gravadas no bucket público `product-images`.
