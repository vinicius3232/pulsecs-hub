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

### Fase A — Ligar o Supabase real (depende do usuário)
**Objetivo:** sair do modo demonstração e validar de ponta a ponta.

Tarefas
- A1. Escrever `scripts/bootstrap-supabase.md` com o passo a passo exato: criar projeto, aplicar `schema.sql` e `0002`–`0006` na ordem, desativar cadastro aberto, criar usuários e vinculá-los em `csm` com o papel certo, `seed.sql` opcional.
- A2. Criar `scripts/smoke-real.mjs` que, com `SUPABASE_URL` e chaves de teste em variáveis de ambiente, verifica: cada papel lê só o que deve, escrita negada devolve 0 linhas, webhook cria uma empresa, cron roda sem erro. Imprime aprovado/reprovado por item. **Não** rodar contra produção sem o usuário pedir.
- A3. Lista de variáveis na Vercel (já em `.env.example`) conferida contra o código: nenhuma faltando, nenhuma sobrando.

Pronto quando: o usuário preenche as chaves, roda `smoke-real.mjs` e todos os itens passam; `public/config.js` preenchido faz o app entrar em modo banco.
Limite: o agente não tem as chaves do usuário. Entregar o script e o roteiro; **não** pedir chaves em chat.

### Fase B — Dados reais de uso (bloqueada por uma resposta do usuário)
**Pergunta aberta:** como a plataforma de benefícios entrega os dados de uso (API, CSV, acesso ao banco)? **Pare e pergunte** antes de começar.

Tarefas (depois da resposta)
- B1. Adaptador de entrada para o formato real, que converte para o contrato de `/api/ingest/metrics` (lote ≤ 500, `INGEST_SECRET`).
- B2. Rotina diária (cron ou job externo) com reexecução segura (idempotente) e relatório de linhas aceitas/rejeitadas.
- B3. Mapeamento cliente da plataforma ↔ empresa do PulseCS (chave estável, não nome) e fila de "sem correspondência" para revisão manual.
- B4. Calibração do Health Score: tornar os pesos configuráveis (tabela `health_config`, só Head altera, com histórico), rodar com ~5 clientes reais e comparar com o julgamento dos CSMs. Manter a paridade SQL × TS (`test:health`).

Pronto quando: um dia de dados reais entra sozinho, o score recalcula e a divergência SQL × TS é zero nos testes.

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
