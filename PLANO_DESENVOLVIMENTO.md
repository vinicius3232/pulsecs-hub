# PulseCS — Plano de desenvolvimento (para o Antigravity)

Este plano cobre o que falta no sistema **fora da UI**. A UI (acessibilidade, celular, menu) está em `PLANO_UIUX.md` e é outro trabalho. Leia as seções 1 a 3 antes de qualquer tarefa.

## 1. Contexto

PulseCS é uma plataforma de Customer Success para uma empresa que vende benefícios corporativos a empresas (os colaboradores dos clientes usam os benefícios). Papéis: `head`, `csm`, `is`, `viewer`.

**Stack**
- Front estático: `public/index.html` (Tailwind CDN, Lucide, Chart.js, supabase-js) mais `public/data-layer.js`, `today.js`, `automations.js`. Sem build.
- API: funções serverless TypeScript na Vercel, em `api/` (Node ESM; **imports relativos terminam em `.js`**).
- Lógica compartilhada: `src/lib/` (automação, ingestão, Salez, rate limit, health score).
- Banco: Supabase (Postgres + Auth + RLS). Migrations em `supabase/migrations/` (0002 a 0006) e `supabase/schema.sql`.
- Deploy: push na `main` publica na Vercel. Site é `public/`; cron diário em `/api/cron/drain-events`.

**Estado atual (commit `a685f22`)**
- Feito e testado em banco embutido (PGlite) e navegador simulado: RLS por papel, login Supabase, IA só pelo servidor, event log + motor de automação (create_task, add_note, http_request, delay, if/else), Health Score no SQL, painel "Hoje", aba Automações (leitura, ativar/desativar, executar agora), linha do tempo do cliente, webhook Salez idempotente, rate limit global (Upstash opcional), ingestão `/api/ingest/metrics`.
- **Nunca testado contra um Supabase ou Upstash reais.** O site em produção roda em modo demonstração porque `public/config.js` está vazio.
- Telas ainda com dados de exemplo: Relatórios/QBR, Campanhas, Parceiros, Lembretes, Central Omnichannel.

## 2. Regras de trabalho (obrigatórias)

1. **Conflito com o plano de UI:** o outro trabalho mexe em `public/index.html`. Neste plano, **não edite `index.html` além do mínimo** (ligar um script novo, um contêiner de aba). Toda lógica nova vai em arquivos próprios (`public/<nome>.js`, `src/lib/...`). Trabalhe numa branch `feat/dev-*` por tarefa e abra PR; não faça push direto na `main`.
2. **Segredos:** nunca grave chave real no repositório. `SUPABASE_SERVICE_ROLE_KEY` só no servidor. A chave anon vai em `public/config.js` (é pública por desenho).
3. **Segurança primeiro:** toda tabela nova tem RLS ligada, política por papel e teste em `supabase/tests/`. Toda rota nova autentica (JWT do Supabase ou segredo), valida entrada, aplica `rateLimited` e falha fechada (401/503/405).
4. **Migrations:** só novas (`0007_...`), idempotentes (`IF NOT EXISTS`), nunca editar as antigas. Atualize `supabase/schema.sql` junto.
5. **Teste obrigatório por tarefa**, no padrão existente (node:test + tsx; PGlite para SQL). Para cada correção de bug, um teste que falhe antes. Faça uma verificação de mutação: quebre a regra de propósito e confirme que o teste falha.
6. **Não declare pronto sem rodar** todos os comandos da seção 3. Diga o que não conseguiu verificar (ex.: serviço externo real).
7. **Não invente dados de negócio.** Pesos do score, metas e regras vêm do usuário ou ficam como configuração.
8. Texto de interface em português do Brasil, sem emoji novo.

## 3. Comandos de verificação

```bash
npm test                  # 7 suítes: automação, ingestão, salez, ratelimit, data-layer, today, automations
npm run test:rls          # RLS por papel
npm run test:health       # Health Score SQL x TypeScript
npm run test:idempotency  # UNIQUEs e webhook
npx tsc --noEmit          # tipos estritos
```

Linha de base hoje: 105 testes passando (75 + 13 + 10 + 7). Não pode cair.

## 4. Fases

Ordem sugerida. A Fase A é pré-requisito de tudo que depende de dados reais.

### Fase A — Ligar o Supabase real (CONCLUÍDA)
**Branch:** `feat/dev-fase-a-bootstrap` (PR aberta)  
**Objetivo:** Guiar provisionamento do Supabase real, segurança de acesso e esteira de CI.

Tarefas Concluídas
- [x] A1. Escrito `scripts/bootstrap-supabase.md` com o passo a passo exato: criar projeto, aplicar `schema.sql` e `0002`–`0007` na ordem, desativar cadastro aberto, criar usuários e vinculá-los em `csm_users` com o papel certo, `seed.sql` opcional.
- [x] A2. Criado `scripts/smoke-real.mjs` que valida isolamento de papéis, RLS com anon, escrita protegida e idempotência com cleanup automático.
- [x] A3. Lista de variáveis na Vercel e `.env.example` auditada e 100% alinhada com o codebase.
- [x] F4. Pipeline de CI do GitHub Actions `.github/workflows/ci.yml` cobrindo todas as suítes de teste e `tsc --noEmit`.

---

### Fase B — Dados reais de uso (CONCLUÍDA)
**Branch:** `feat/dev-fase-b-ingest-health-config` (PR aberta)  
**Entrada definida:** API / Webhook via POST JSON estruturado para `/api/ingest/metrics`.

Tarefas Concluídas
- [x] B1. Adaptador em `src/lib/ingest.ts` e `api/ingest/metrics.ts` suportando `company_id`, `cnpj`, `platform_id` e `external_id` (lotes $\le 500$, `INGEST_SECRET`).
- [x] B2. Reexecução segura e idempotente com relatório discriminado de linhas atualizadas e falhas/rejeitadas.
- [x] B3. Mapeamento estável via tabela `company_external_mappings` e fila de contingência `unmatched_metrics` para telemetria sem correspondência imediata com RLS para CSM/Head.
- [x] B4. Calibração do Health Score: tabela `health_config` (somente Head altera via RLS), função SQL `fn_health_calc_configurable`, interface `HealthScoreConfig` no TypeScript com 100% de paridade validada no `npm run test:health`.


### Fase C — Telas que ainda são demonstração (ligar ao banco)
Para cada tela: tabela + RLS + mapeador puro em arquivo próprio + teste vm + ligação em modo banco; no modo demonstração continua igual.

- C1. **Lembretes:** tabela `reminders` (dono, empresa opcional, data, feito). CSM vê os seus; Head vê todos.
- C2. **Relatórios/QBR:** gerar o QBR a partir de dados reais (score, tendência, tarefas, adoção, contatos). Entregar como página imprimível primeiro; PDF no servidor só depois. Mostrar a origem de cada número.
- C3. **Campanhas e régua:** tabelas `campaigns` e `campaign_sends`; sem envio real até a Fase D. Estados: rascunho, agendada, enviada.
- C4. **Parceiros e LGPD:** `partners`, registro de consentimento e pedido do titular (`data_requests`) com prazo e responsável.
- C5. **Histórico de receita:** `revenue_snapshots` mensais para MRR/NRR de verdade (hoje é aproximação).

Pronto quando: cada tela lê e grava no banco com RLS testada, e o selo "Exemplo" some da tela.

### Fase D — Automação e integrações
- D1. **Editor de regras** (hoje só por SQL): criar/editar/clonar regra com gatilho, condições e passos; validar no servidor com os mesmos tipos do motor (`src/lib/automation/types.ts`); só Head; testes de validação e de rejeição de regra inválida.
- D2. **Envio real de mensagens** (e-mail/WhatsApp) como novo tipo de passo `send_message`, atrás de provedor configurável, com limite por empresa, horário permitido, opt-out e registro em `interactions`. Sem provedor configurado, o passo falha com mensagem clara.
- D3. **Entrega "exatamente uma vez" para `add_note` e `http_request`:** chave de idempotência por (execução, passo) gravada antes do efeito; teste de queda no meio da retomada. Hoje é "pelo menos uma vez" (limitação documentada).
- D4. **Observabilidade:** log estruturado nas rotas, página de saúde do sistema (fila de eventos, mortos, atrasos) só para Head, alerta quando a fila passa de um limite.

### Fase E — IA e previsão (P4)
Só começa quando a Fase B entregar dados reais e houver pelo menos 3 meses de snapshots.
- E1. **Copilot com contexto real:** o servidor monta o contexto (empresa, score, fatores, últimas interações) sem dados pessoais de colaboradores; resposta cita de onde veio cada afirmação; recusa quando faltar dado.
- E2. **Previsão de churn:** começar com regra explicável (queda de score + queda de uso + renovação próxima) e medir acerto contra churn real antes de qualquer modelo. Publicar a métrica na tela; não esconder incerteza.
- E3. **Resumo de QBR por IA** a partir do C2, com o texto sempre editável antes de enviar.

### Fase F — Produção e governança
- F1. **Sentry** (front e funções), com remoção de dados pessoais antes do envio.
- F2. **Backup e restauração:** rotina documentada e um teste de restauração feito de verdade.
- F3. **LGPD:** inventário de dados pessoais por tabela, retenção, exportação e exclusão por titular, trilha de auditoria de quem leu/alterou dados sensíveis. Revisão jurídica fica com o usuário.
- F4. **CI no GitHub Actions:** rodar a seção 3 em todo PR; bloquear merge se falhar.
- F5. **Cabeçalhos e CSP:** apertar a CSP depois que a UI compilar o Tailwind (depende do plano de UI, Onda 4).

## 5. Ordem e dependências

```
A (ligar banco) ──► B (dados reais) ──► E (IA/previsão)
      │                  │
      └──► C (telas) ────┴──► D (automação/integrações) ──► F (produção)
```
- A, depois C1–C5 e D1/D3 podem andar sem esperar a B.
- F4 (CI) pode ser feito já, antes de tudo.
- E nunca antes de B.

## 6. Fora do escopo deste plano
- Qualquer mudança visual, acessibilidade, menu ou celular (`PLANO_UIUX.md`).
- Decisões de negócio: pesos finais do score, preços, textos jurídicos.
- Acesso a contas do usuário (Supabase, Vercel, Upstash, Salez) sem ele fornecer.

## 7. Como reportar a cada tarefa
Uma PR por tarefa, com: o que mudou, testes novos, saída dos comandos da seção 3, e uma linha "não verifiquei: ...". Se algo bloquear (dado ou acesso), pare e pergunte em vez de supor.
