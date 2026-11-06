# 🚀 PulseCS — Enterprise Customer Success & Benefits Adoption Hub

Uma solução corporativa completa de **Customer Success (CSM)**, **Onboarding por Marcos**, **Adoption Health Score**, **Pipeline de Renovação**, **Studio de Campanhas & Kits RH** e **Rede de Benefícios Corporativos com Governança LGPD**.

Desenvolvida com base nos melhores padrões arquiteturais do **`DeskcommCRM`** e do **`Cannabis-Associacao-RJ`**, equipada com suporte nativo a **Groq (LPU Ultra-Fast)**, **Google Gemini**, **OmniRoute Gateway**, **Vercel Serverless Functions** e **Supabase (PostgreSQL + RLS)**.

🔗 **Repositório GitHub:** [https://github.com/vinicius3232/pulsecs-hub](https://github.com/vinicius3232/pulsecs-hub)

---

## 🌟 Módulos Implementados (Fases 0 a 6 do Plano de Benefícios)

### 1. 🎯 Health Score por Adoção & ROI de Benefícios (Fases 0 e 2)
Diferente de SaaS tradicional baseado apenas em login, o PulseCS calcula o Health Score focado no valor real gerado para os colaboradores da empresa cliente:
- **Fórmula de Adoção:**
  $$\text{Score} = (0.35 \times \text{Ativação}) + (0.25 \times \text{MAU}) + (0.15 \times \text{Engajamento RH}) + (0.15 \times \text{Renovação}) + (0.10 \times \text{NPS}) - 25 \text{ (se inadimplente)}$$
- **Métricas Chave por Empresa:** Vidas Elegíveis, Vidas Ativadas, MAU (Uso Mensal Efetivo), Economia Acumulada em R$ pelos colaboradores, PEPM (Preço por Vida/Mês).
- **Detecção de Riscos Automática:** Alertas imediatos para baixa ativação (< 40%), queda de uso mensal, inadimplência e contratos a menos de 90 dias da renovação.

### 2. 🚀 Onboarding por Marcos (Fase 3)
Kanban estruturado com base em marcos de entrega contínua para empresas de benefícios:
1. **Carga de Base:** Importação e conferência das vidas elegíveis.
2. **Disparo de Convites:** Disparo das credenciais e ativadores via e-mail e WhatsApp corporativo.
3. **$\ge 50\%$ Ativação:** Marco crítico de adoção para validação do programa.
4. **Primeiro Uso Efetivo:** Registro das primeiras transações ou utilização dos vouchers.
5. **Go-Live:** Transição formal de Onboarding para a carteira de CS contínuo.

### 3. 🔄 Pipeline de Renovação & QBR Instantâneo em PDF (Fase 4)
- **Colunas Temporais:** Acompanhamento dinâmico de contratos a **90 Dias**, **60 Dias**, **30 Dias** e **Renovados**.
- **NRR Real:** Taxa de Retenção Líquida calculada automaticamente (ex: **108.4%** de retenção com expansão de vidas).
- **QBR Instantâneo (Executive Review):** Modal executivo com resumo de ROI pronto para apresentação ao RH e Decisor Financeiro, detalhando economia total gerada, taxa de ativação e comparativo com a carteira.

### 4. 📢 Campanhas & Studio de Kits RH com IA (Fase 5)
- **Studio de Kits de Comunicação:** Gerador assistido por IA (Groq, Gemini, OpenAI) de peças prontas para o RH distribuir aos colaboradores:
  - 📧 **E-mail Corporativo** com chamadas persuasivas e links diretos para ativação do app.
  - 💬 **WhatsApp / Slack** no formato direto, emojis e instruções de primeiro uso.
  - 📋 **Cartaz de Mural / PDF** com passo a passo e QR Code para a copa ou mural de avisos da empresa.
- **Calendário Sazonal Integrado:** Programação de campanhas temáticas com 1 clique (Novembro Azul, Black Friday de Vouchers, Janeiro Branco de Saúde Mental, etc.).

### 5. 🤝 Rede de Parceiros & Governança LGPD (Fase 6)
- **Categorias de Benefícios:** Indicadores de cobertura e satisfação em Alimentação & Refeição, Saúde & Bem-estar, Mobilidade Urbana, Educação & Idiomas e Clube de Descontos.
- **Radar de Demanda Reprimida:** Identificação geográfica de parceiros faltantes (ex: demandas abertas em Curitiba, Belo Horizonte e Campinas).
- **Governança LGPD:**
  - Arquitetura **Zero-Nominal**: Operação estritamente sobre métricas agregadas por empresa e filial.
  - Ledger auditável com registro de consentimento, hash SHA-256 e expurgo programado a cada 90 dias.
  - Exportação de relatório de auditoria e conformidade em JSON com 1 clique.

### 6. 📅 Calendário Operacional de Clientes & Google Workspace
- **Visão Mensal & Semanal:** Grade completa destacando reuniões do dia ("HOJE") e chamadas futuras.
- **Pills com Cores de Health Score:** Verde (Treinamento / QBR), Amarelo (Check-in) e Vermelho (Risco / Churn).
- **Google Meet & Google Agenda:** Abertura direta de salas de conferência e agendamento instantâneo.

### 7. 👥 Gestão de Equipe ("RH de CS") & Balanceamento de Carteira
- Monitoramento da capacidade dos CSMs (Vinícius M., Camila Prado, Lucas Rocha).
- Algoritmo de balanceamento de MRR e volume de contas com 1 clique.

### 8. ⚡ Vercel Serverless Functions & Integrações
- `/api/ai`: Proxy serverless seguro que isola chaves de API (Groq, Gemini, OpenAI) sem expô-las no front-end.
- `/api/salez-webhook`: Endpoint pronto para receber eventos `deal.won` do Salez CRM e criar empresas automaticamente em Onboarding.
- `supabase/schema.sql`: Schema relacional PostgreSQL com tabelas de empresas, contatos, interações, reuniões, snapshots de saúde e políticas de RLS.

---

## 🛠️ Stack Tecnológica

| Componente | Tecnologia | Função |
| :--- | :--- | :--- |
| **Front-end** | Tailwind CSS + Native ES Modules | UI responsiva, dark-mode nativo, alta performance sem overhead |
| **Serverless API** | TypeScript + Vercel Functions | Isolamento de chaves de IA e Webhook de CRM |
| **Banco de Dados** | Supabase (PostgreSQL 15) | Schema relacional, Row Level Security (RLS) e snapshots diários |
| **Provedores de IA** | Groq LPU, Gemini 1.5/2.0, OmniRoute | Geração de kits de comunicação, diagnósticos de risco e QBR |
| **Qualidade & QA** | Playwright Headless Automation | Verificação contínua de renderização e zero erros de console |

---

## 🚀 Como Executar Localmente

1. Clone o repositório:
   ```bash
   git clone https://github.com/vinicius3232/pulsecs-hub.git
   cd pulsecs-hub
   ```
2. Abra o arquivo `public/index.html` em qualquer navegador ou use um servidor local:
   ```bash
   npx serve .
   ```
3. Para rodar com as Serverless Functions locais:
   ```bash
   npx vercel dev
   ```

---

## ☁️ Deploy na Vercel

O projeto possui configuração pronta no `vercel.json`:
1. Faça um fork ou conecte o repositório no seu dashboard da **[Vercel](https://vercel.com)**.
2. Adicione as variáveis de ambiente opcionais:
   - `GROQ_API_KEY`
   - `GEMINI_API_KEY`
   - `OPENAI_API_KEY`
   - `SUPABASE_URL` / `SUPABASE_ANON_KEY`
3. O deploy é concluído automaticamente com HTTPS nativo e preview de pull requests.

---

## 🔒 Segurança e Privacidade
- **Zero-Nominal Data (LGPD):** Não armazena CPF, nomes ou dados sensíveis individuais de funcionários das empresas clientes.
- **Fail-Safe Serverless:** Se as chaves de API não forem configuradas no Vercel, o sistema faz fallback elegante para o Copilot Pro Simulado local, garantindo operação contínua sem interrupções.

---

## 🔒 Endpoints `/api` (variáveis de ambiente)
Copie `.env.example` e cadastre os valores em **Vercel > Settings > Environment Variables**.

- `POST /api/ai`: exige `Authorization: Bearer <JWT do Supabase Auth>`; 20 chamadas/min por usuário; provedores e modelos em allowlist; sem CORS aberto (use `ALLOWED_ORIGINS` para liberar origens).
- `POST /api/salez-webhook`: exige o cabeçalho `x-webhook-secret` (ou `Authorization: Bearer`) igual a `SALEZ_WEBHOOK_SECRET`; grava a empresa em `Kickoff` no Supabase via service role (somente servidor).
- Sem as variáveis configuradas, ambos respondem 401/503 (falham fechados).

---

## ⚙️ Event log + motor de automação
Padrão adaptado do DeskcommCRM (MIT): triggers do Postgres só gravam em `event_log`; um cron drena a fila.

- **Aplicar, nesta ordem:** `supabase/schema.sql`, `supabase/migrations/0002_event_log_automation.sql` e `supabase/migrations/0003_workflow_steps_and_views.sql` (idempotentes).
- **Eventos:** `company.created`, `company.health_changed`, `company.phase_changed` (triggers) e `company.renewal_due` (90/60/30 dias) e `company.rh_inactive` (14 dias sem login), emitidos por `fn_emit_time_events()` sem duplicar.
- **Regras:** tabela `automation_rules` (QUANDO / SE em AND / ENTÃO). Condições: `eq neq contains gt gte lt lte`. Templates `{{company.name}}`. Regras padrão já vêm nas migrations.
- **Execução:** `GET /api/cron/drain-events` (Vercel Cron, 1x/dia no plano Hobby; exige `CRON_SECRET`). Falha → retry com backoff 2^n min; 5 falhas → `dead` + tarefa crítica para o Head.
- **Testes:** `npm test` (lógica do motor).

### Passos das regras (ENTÃO)
| Passo | Config | Observações |
|---|---|---|
| `create_task` | `title`, `body?`, `severity?` | No máximo 1 tarefa aberta por regra+empresa |
| `add_note` | `content` | Grava na linha do tempo (`interactions`, canal `note`) |
| `http_request` | `url`, `method?`, `body?` | **Só hosts em `AUTOMATION_HTTP_ALLOWLIST`**, HTTPS, sem IP/localhost/credenciais, sem redirecionamento. Vazia = nega tudo |
| `delay` | `days?`, `hours?` (até 90 dias) | Só no nível raiz. A regra pausa e o cron a retoma, **refazendo o contexto** (empresa de agora) |
| `if` | `conditions`, `then`, `else?` | Ramos aceitam os demais passos (sem `delay`); aninhável até 5 níveis |

- **Atenção ao delay:** o cron roda 1x/dia no plano Hobby, então a retomada acontece na próxima execução depois do horário. Em Pro, agende com mais frequência.
- **Entrega "pelo menos uma vez":** se a retomada falhar no meio, o passo é repetido. `create_task` é idempotente; `add_note` e `http_request` podem repetir.
- **Execução manual:** `POST /api/automation/run` com `{ "rule_id", "company_id" }` e `Authorization: Bearer <JWT do Supabase>`. A regra precisa ter `trigger_event = "manual.run"`. Head executa em qualquer empresa; CSM só nas suas. Roda na hora (não espera o cron).

### Views salvas da carteira
Dashboard › Carteira: visões prontas (Em risco, Atenção, Em onboarding, Maiores contas, Enterprise saudáveis) e visões pessoais ("+ Salvar visão atual"). Uma visão guarda busca, plano, saúde, fase, responsável e ordenação. No protótipo ficam em `localStorage` (`pulsecs_views`); a tabela `public.saved_views` (migration 0003, com RLS) está pronta para quando o front usar o Supabase.

---

## 🔐 Acesso, perfis e RLS (P0)
O front só controla a experiência; **quem protege os dados é a RLS do banco** (`supabase/migrations/0004_rls_by_role.sql`) e a validação do JWT nas funções `/api`.

| Perfil (`csm_users.role`) | Lê | Escreve |
|---|---|---|
| `head` | tudo | tudo (empresas, equipe, regras, tarefas) |
| `csm` | tudo | só as empresas **suas** (e assume as sem gestor), com contatos, reuniões e interações delas; suas tarefas e visões |
| `is` | tudo | empresas **fora de Go-Live** (avança onboarding); não reatribui nem altera valores/contrato |
| `viewer` | tudo | nada de negócio (só as próprias visões) |
| fora da equipe ou inativo | **nada** | **nada** (mesmo autenticado) |

- `anon` não acessa nenhuma tabela. `event_log`, execuções e passos agendados são legíveis só pelo Head. Snapshots, eventos e funções de worker só o service role escreve/chama.
- **Teste:** `npm install && npm run test:rls` roda 13 cenários por perfil num Postgres embutido (PGlite). Sem a migration 0004, 11 deles falham.

### Ativar o login (uma vez)
1. No Supabase aplique, nesta ordem: `schema.sql`, `0002`, `0003`, `0004`, `0005` (e `seed.sql`, se quiser dados de exemplo).
2. **Authentication › Sign In / Providers › Email › desligue "Allow new users to sign up"** (a RLS já nega tudo a quem não está na equipe, mas não deixe a porta aberta).
3. Crie os usuários em Authentication › Users (convite) e vincule ao perfil:
   ```sql
   -- ajuste os e-mails do seed.sql para os reais antes de rodar
   update public.csm_users c set auth_id = u.id
     from auth.users u where lower(u.email) = lower(c.email) and c.auth_id is null;
   ```
4. Preencha `public/config.js` com a **URL** e a chave **anon public** do projeto (são públicas por desenho; **nunca** a service role). Vazio = modo demonstração.
5. Na Vercel, cadastre as variáveis do `.env.example` (as chaves de IA ficam **só lá**).

Com o login ativo: o Painel Master abre por papel (`head`), sem senha local; o Copilot chama `/api/ai` com o JWT; **nenhuma chave de IA é digitada nem guardada no navegador** (chaves antigas salvas no `localStorage` são apagadas ao carregar).

> Com o login ativo, a carteira vem do banco (ver P1 abaixo). Sem `config.js` preenchido, o app roda em modo demonstração.

---

## 🗄️ Carteira no banco, Health Score do servidor e painel "Hoje" (P1–P3)

### P1 — A carteira vem do Supabase
Com login ativo (`public/config.js` preenchido), `public/data-layer.js` carrega **empresas, contatos, equipe, reuniões e tarefas** do banco e grava as edições (criar, editar, mover de fase, reatribuir, excluir) por diferença. Sem login, tudo segue como antes: modo demonstração com `localStorage`.

- **A RLS decide o que cada perfil grava.** O banco não devolve erro quando bloqueia um `UPDATE`, só afeta 0 linhas; a camada de dados confirma as linhas afetadas, avisa com um toast e **recarrega o estado real do banco** (a tela nunca fica mostrando algo que não foi salvo).
- Estados explícitos: carregando, erro com "Tentar de novo", e uma faixa no topo (`Conectado ao banco · N empresas · salvo às HH:MM`).
- Abas com conteúdo fixo (Relatórios, Campanhas, Parceiros, Lembretes) ganham o aviso "Conteúdo de demonstração".
- Números que **não existem no banco** (NRR, variação de MRR, taxa de resposta) aparecem como "—" no modo banco; adoção média, economia gerada e MRR a renovar são **calculados** das empresas.
- O e-mail do contato é obrigatório no banco; contatos criados pela tela sem e-mail usam o placeholder `sem-email@pulsecs.invalid`.

### P2 — Health Score calculado no servidor (`0005_health_score_server.sql`)
O score deixa de ser digitado. O banco calcula com a fórmula de `src/lib/health-score.ts` (ativação 35%, MAU 25%, RH 15%, renovação 15%, NPS 10%, −25 por inadimplência).

- **Paridade testada:** `npm run test:health` compara SQL × TypeScript em 600 combinações (score, status, taxas e fatores).
- **Recalcula sozinho** (gatilho) quando mudam vidas, login do RH, renovação, NPS ou inadimplência, e **todo dia no cron** (dias para renovar e sem login mudam com o tempo). Grava **um snapshot por dia** em `health_snapshots` (alimenta o gráfico de tendência).
- **Sem métricas, sem nota:** empresa com `eligible_lives = 0` não é pontuada (nenhum falso alarme); o Raio-X diz o motivo.
- **Ninguém semeia números:** `csm` e `is` não alteram métricas, renovação nem score; empresas criadas por CSM nascem com padrões. O `head` pode corrigir métricas (o score é recalculado).
- Dados coerentes: `ativadas ≤ elegíveis`, `MAU ≤ ativadas`, sem negativos (CHECK no banco).
- Mudança de status (ex.: verde → vermelho) gera `company.health_changed`, que dispara as automações.

**Ingestão de métricas** (a "telemetria diária" da plataforma de benefícios):

```bash
curl -X POST https://SEU-DOMINIO/api/ingest/metrics \
  -H "x-ingest-secret: $INGEST_SECRET" -H "Content-Type: application/json" \
  -d '{"items":[{"cnpj":"12.345.678/0001-90","eligible_lives":1000,"active_lives":800,"mau_lives":600,"total_savings":48200.5,"nps_score":8.5,"has_overdue_invoice":false,"last_login_at":"2026-11-05T10:00:00Z"}]}'
```
- Identifica a empresa por `company_id` (uuid) ou `cnpj` (14 dígitos, **guarde o CNPJ só com dígitos** em `companies.cnpj`). Até 500 itens por chamada; parcial (só os campos enviados); idempotente.
- Resposta: `{ received, updated, failed: [{ index, reason }] }`. Quem envia reenvia só o que falhou.
- Segredo em `INGEST_SECRET` (falha fechada sem ele), limite por IP, validação estrita (só chaves conhecidas entram no UPDATE).

### P3 — Painel "Hoje" (aba inicial)
Quanto da receita está em risco, quais contas exigem ação e por quê, e a próxima ação. As tarefas criadas pelas automações aparecem aqui e podem ser **concluídas** na própria tela (só o dono da tarefa ou o Head; senão o banco recusa e a tela avisa). Prioridade: críticas primeiro, depois maior MRR, depois a mais antiga. Conta crítica **sem tarefa aberta** aparece como "sem ação registrada". Tarefas paradas há 7+ dias são contadas à parte.

### Testes
| Comando | O que cobre |
|---|---|
| `npm test` | motor de automação, validação da ingestão, camada de dados e painel "Hoje" |
| `npm run test:rls` | 13 cenários de permissão por perfil (Postgres embutido) |
| `npm run test:health` | paridade SQL × TS, recálculo, snapshots, guardas de coluna, `seed.sql` |

### Ordem das migrations
`schema.sql` → `0002` → `0003` → `0004` → `0005`, depois `seed.sql` (opcional). Todas idempotentes.
