# Revisão de segurança — 2026-07-14

## Dados locais

Chaves antigas com dados pessoais, pedidos, logs e credenciais não são mais
copiadas para `triaxis_legacy_*`. Se forem encontradas, o usuário escolhe criar
um backup AES-GCM protegido por senha antes da remoção. Cancelar ou não confirmar
o arquivo preserva os dados e bloqueia o aplicativo sem renderizá-los. Pedidos
válidos permanecem no Supabase. Logout e troca de conta limpam memória, interface
e chaves de runtime antes de qualquer nova consulta.

## Papéis

- `admin`: catálogo administrativo, configurações e produção;
- `production`: somente quadro de produção e RPCs permitidas de pedidos;
- `customer`: catálogo público, perfil e seus próprios pedidos;
- perfil suspenso: nenhuma função protegida, mesmo que ainda tenha um papel.

## Pedidos

A intenção de pedido recebe uma chave de idempotência antes da chamada de rede.
Um digest SHA-256 não reversível do payload canônico vincula a chave ao produto,
quantidade, configuração e observações, sem armazenar esses valores. Resposta
perdida mantém a chave. Fechar ou alterar o draft força consulta de reconciliação
por `idempotency_key`; pedido já commitado é retornado, não duplicado. Intenções
expiram em 24 horas e são apagadas em logout ou boot confirmado sem sessão.
Esse horizonte de 24 horas é uma política operacional: durante ele, intenções
enviadas podem ser reconciliadas apenas pela chave e pelo digest, sem reter PII.
Depois do prazo, o cliente remove o registro local; monitoramento/auditoria do
banco continua sendo a fonte para investigar pedidos antigos.

Cada tentativa também possui uma versão volátil. Uma reconciliação iniciada ao
fechar o modal só altera o registro se chave, versão, fingerprint e estado ainda
forem exatamente os capturados; assim ela não apaga uma tentativa reaberta em
paralelo.

## Imagens privadas

Admin ativo pode ler e assinar o upload privado ainda não vinculado para concluir
`sync_catalog`. Anônimo somente lê objeto vinculado a produto publicado e ativo.
Falhas de upload/sincronização disparam limpeza dos objetos novos. URLs assinadas
são renovadas aos 45 minutos, ao retornar à aba e após erro de imagem.

## Riscos residuais não resolvidos

Não foi encontrada cópia local verificável de `@supabase/supabase-js@2.49.4` nos
caches do Codex/npm/Documentos. Registro npm e CDN estavam inacessíveis pela rede
restrita. Por isso o SDK continua em URL de versão exata, com `crossorigin` e CSP,
mas sem SRI/self-hosting. Nenhum hash foi inventado. Só marque como resolvido após
obter, auditar e versionar o bundle junto da licença e hash dos bytes publicados.

Scripts inline são proibidos pela CSP. `style-src 'unsafe-inline'` ainda é um
risco residual porque a interface legada usa estilos dinâmicos para fotos,
imagens e variáveis de layout. Retirá-lo agora quebra esses fluxos; primeiro é
necessário migrá-los para classes/regras CSS locais.

GitHub Pages não permite configurar cabeçalhos HTTP como `X-Frame-Options` ou
`Content-Security-Policy: frame-ancestors`. A CSP em `<meta>` não aceita
`frame-ancestors`, portanto clickjacking permanece um risco externo não resolvido.
A correção exige hospedagem/CDN capaz de enviar `frame-ancestors 'none'` (ou
`X-Frame-Options: DENY`) como cabeçalho de resposta.
