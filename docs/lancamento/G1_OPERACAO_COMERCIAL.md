# G1 — Operação comercial

Status: **aprovado**

Critério do gate: capacidade, políticas comerciais e responsáveis documentados
e aprovados antes da publicação do primeiro drop.

## Como preencher

1. Revise cada decisão da seção **Políticas para aprovação**.
2. Altere somente a coluna **Decisão final** quando não concordar com a
   recomendação.
3. Troque `[ ]` por `[x]` na coluna **Aprovado** após confirmar a decisão.
4. Preencha a quantidade total do Omega Pass.
5. Conclua o checklist e a declaração de aceite no fim do documento.

Não registre nome completo, telefone, e-mail pessoal, documento, senha, token ou
qualquer outro dado sensível. Os responsáveis podem ser identificados somente
pela função.

## Escopo do primeiro drop

| Tema | Definição estabelecida |
|---|---|
| Ambiente atual | QA público, isolado da produção |
| Provedor de pagamento | Mercado Pago |
| Moeda | BRL |
| Região inicial | Brasil |
| Catálogo | Vector Sigil, Omega Pass e Mini Logo Tag |
| Vector Sigil | R$ 19,90 · produção estimada em 1–2 dias |
| Omega Pass | R$ 34,90 · produção estimada em 2–3 dias · edição limitada |
| Mini Logo Tag | R$ 14,90 · produção estimada em 1 dia |
| Confirmação financeira | Somente o servidor confirma o pagamento |
| Liberação para produção | Somente após pagamento aprovado e conciliado |

## Políticas para aprovação

As decisões abaixo são uma base conservadora. Edite a coluna **Decisão final**
antes de aprovar quando necessário.

| Código | Tema | Recomendação conservadora | Decisão final | Aprovado |
|---|---|---|---|:---:|
| G1-01 | Capacidade semanal total | 20 unidades por semana, somando todos os produtos | 15 unidades por semana | [x] |
| G1-02 | Limite Vector Sigil | Até 10 unidades por semana | 8 unidades por semana | [x ] |
| G1-03 | Limite Omega Pass | Até 5 unidades por semana, respeitando o estoque total do drop | 4 unidades por semana | [x ] |
| G1-04 | Limite Mini Logo Tag | Até 10 unidades por semana | 8 unidades por semana | [x ] |
| G1-05 | Limite por pedido | Até 3 unidades de cada produto por pedido | 1 unidades por produto | [x ] |
| G1-06 | Entrega inicial | Retirada combinada; envio somente após cotação e aceite do frete | Retirada combinada ou envio após cotação | [ x] |
| G1-07 | Região atendida | Brasil | Brasil | [ x] |
| G1-08 | Prazo de postagem | Prazo de produção informado no produto + até 2 dias úteis | Produção + até 2 dias úteis | [x ] |
| G1-09 | Cancelamento antes da produção | Reembolso integral quando a produção ainda não começou | Reembolso integral antes da produção | [x ] |
| G1-10 | Cancelamento após início da produção | Avaliação individual; informar custos já incorridos antes da decisão | Avaliação individual documentada | [x ] |
| G1-11 | Produto personalizado | Sem troca por preferência; corrigir defeito ou divergência do pedido | Sem troca por preferência | [ x] |
| G1-12 | Defeito ou divergência | Reproduzir, corrigir ou reembolsar conforme o caso | Correção ou reembolso após análise | [ x] |
| G1-13 | Prazo para relatar problema | Até 7 dias corridos após o recebimento | 7 dias corridos | [x ] |
| G1-14 | Frete de correção por falha da TriAxis | Responsabilidade da TriAxis | Responsabilidade da TriAxis | [x ] |
| G1-15 | Atendimento | Canal oficial com resposta inicial em até 2 dias úteis | Resposta em até 2 dias úteis | [ x] |
| G1-16 | Exceções | Toda exceção de preço, prazo, cancelamento ou reembolso deixa histórico | Registro obrigatório | [x ] |

Os limites individuais podem somar mais de 20 unidades, mas a produção total da
semana nunca pode ultrapassar o limite definido em `G1-01`.

## Quantidade limitada do Omega Pass

Esta quantidade representa o estoque total da edição do primeiro drop, não a
capacidade semanal.

| Campo | Valor |
|---|---|
| Quantidade total da edição | 40 |
| Reposição após esgotamento | Somente em um novo drop |
| Regra de reserva | Reserva somente após pedido criado e pagamento iniciado |
| Confirmação da venda | Somente após pagamento aprovado |
| Unidade não paga ou expirada | Retorna ao estoque |

## Responsáveis operacionais

Use funções em vez de dados pessoais.

| Responsabilidade | Função responsável | Aceite |
|---|---|:---:|
| Decisões comerciais e preços | Titular da marca | [x ] |
| Conta e conciliação do Mercado Pago | Titular da conta Mercado Pago | [ x] |
| Produção e controle de capacidade | Operador designado | [ x] |
| Atendimento e acompanhamento de pedidos | Operador designado | [ x] |
| Publicação do catálogo | Administrador do catálogo | [x ] |
| Aprovação de reembolsos | Titular da conta Mercado Pago | [ x] |

## Regras operacionais obrigatórias

- [x ] Nenhum valor enviado pelo navegador é tratado como fonte autoritativa.
- [x ] Pedidos sem confirmação do provedor não entram em produção.
- [ x] Preço, configuração e total ficam registrados no snapshot do pedido.
- [x ] Alterações de preço são registradas antes da publicação do catálogo.
- [ x] Limites de produção são verificados antes de aceitar novos pedidos.
- [x ] Exceções de prazo, cancelamento e reembolso deixam histórico.
- [x ] Credenciais e dados de QA não são reutilizados em produção.
- [ x] Senhas, tokens, chaves e dados reais de pagamento não entram no Git.

## Checklist de fechamento

- [x ] Todas as decisões `G1-01` a `G1-16` foram aprovadas.
- [x ] A quantidade total do Omega Pass foi definida.
- [x ] Preços e prazos foram comparados com a capacidade real.
- [x ] Os responsáveis aceitaram suas funções.
- [x ] As políticas de entrega, cancelamento, troca e defeito foram aprovadas.
- [x ] O catálogo do G2 reflete as decisões deste documento.
- [x ] Não existe pendência comercial crítica para o primeiro drop.

## Aceite do G1

Preencha esta seção somente após concluir todos os itens anteriores.

| Campo | Preenchimento |
|---|---|
| Decisão | APROVADO |
| Data | 04/08/2026 |
| Responsável pela decisão | Samp |
| Observações |Sem observação |

### Declaração

- [x ] Confirmo que as decisões acima representam a operação prevista para o
  primeiro drop.
- [ x] Confirmo que mudanças posteriores deverão ser registradas antes de serem
  aplicadas ao catálogo ou aos pedidos.
