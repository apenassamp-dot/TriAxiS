# Instruções de agentes do projeto

## Revisão de código

Sempre que o usuário solicitar revisão, auditoria, inspeção de código, análise de branch, commit, pull request, diff ou alterações locais:

1. Delegue a análise ao custom agent `senior_code_reviewer`.
2. Forneça ao agente o escopo exato da revisão.
3. Instrua-o a permanecer em modo somente leitura.
4. Aguarde a conclusão da revisão antes de responder.
5. Apresente os findings priorizados por severidade.
6. Não edite arquivos, não aplique patches e não implemente correções durante a revisão.
7. Não proponha novas features.
8. Sugira somente a menor correção necessária para cada problema confirmado.
9. Quando a revisão terminar, pare. Qualquer implementação deve ser solicitada separadamente e executada por outro agente.

### Prompt recomendado de delegação

Use o agente `senior_code_reviewer` para revisar o escopo solicitado.
Trabalhe somente em modo leitura.
Não modifique arquivos e não implemente correções.
Priorize bugs, regressões, segurança, integridade de dados, comportamento assíncrono, compatibilidade e lacunas de testes.
Retorne findings concretos com severidade, confiança, arquivo/linha, evidência, impacto, sugestão e validação recomendada.
