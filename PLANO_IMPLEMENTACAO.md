# Plano de Implementação — PulseCS para empresa de benefícios corporativos

Objetivo: transformar o protótipo (HTML único + `localStorage`) em ferramenta de CS usada diariamente pela equipe, orientada à **adoção dos colaboradores** e à **renovação** dos contratos.

Estimativas assumem 1 desenvolvedor; ajustar conforme a equipe.

---

## Fase 0 — Decisões e descoberta (3–5 dias)

Sem isso o resto vira retrabalho.

- [ ] Como a plataforma de benefícios expõe dados? (API, export diário CSV, acesso ao banco, nada)
- [ ] Quais métricas existem hoje: elegíveis, ativados, usos/mês, economia gerada, NPS?
- [ ] Quem usa o sistema (Head, CSMs, IS, leitura) e quais perfis de acesso?
- [ ] Stack: Supabase (Postgres + Auth + RLS) + Vercel Functions. Confirmar.
- [ ] Definir a fórmula do Health Score com o Head de CS (pesos e faixas verde/amarelo/vermelho).
- [ ] Mapear dados pessoais que entrarão (LGPD): base de colaboradores entra ou só métricas agregadas?

**Entrega:** documento de decisões + fórmula do score aprovada.
**Recomendação:** começar só com métricas agregadas por empresa (sem CPF/nome de colaborador). Reduz muito o risco de LGPD.

---

## Fase 1 — Fundação técnica (1–2 semanas)

- [ ] Projeto Vite (vanilla JS ou React) separando módulos: clientes, kanban, calendário, comunicação, equipe, IA, config.
- [ ] Tailwind compilado (remove CDN de dev e permite CSP estrito sem `unsafe-inline`).
- [ ] Supabase: schema inicial (`companies`, `contacts`, `csm_users`, `meetings`, `interactions`, `health_snapshots`).
- [ ] Autenticação real (e-mail + senha ou magic link) e perfis; RLS por CSM/Head.
- [ ] Migração do `localStorage`: script de importação do backup JSON atual.
- [ ] Função serverless `/api/ai` (chave de IA em variável de ambiente; rate limit por usuário).
- [ ] Remover a senha master local e a chave de IA do navegador.
- [ ] CI: lint + testes + deploy preview na Vercel.

**Entrega:** mesmo produto de hoje, mas com login, banco compartilhado e IA via servidor.
**Critério de pronto:** dois CSMs logados veem a mesma carteira em tempo real; nenhuma chave no front.

---

## Fase 2 — Modelo de dados e Health Score por adoção (1–2 semanas)

- [ ] Novos campos por empresa: elegíveis, ativados, MAU, economia gerada, tipo de benefício, valor por vida (PEPM), data de renovação, contato RH x decisor financeiro.
- [ ] Health Score recalculado: ativação, uso mensal, economia por colaborador, NPS, engajamento do admin RH, dias para renovação, inadimplência.
- [ ] Histórico: `health_snapshots` diário/semanal para gráfico de tendência.
- [ ] Alertas automáticos (queda de ativação, sem login do RH, renovação < 90 dias).
- [ ] Testes unitários da fórmula do score (casos limite).
- [ ] Ingestão de dados: conforme Fase 0 (API/CSV/webhook), com importação agendada e tela de status da última sincronização.

**Entrega:** carteira com score real, tendência e motivos de risco calculados.
**Critério de pronto:** score de 5 clientes reais conferido manualmente pelo Head de CS.

---

## Fase 3 — Onboarding por marcos (1 semana)

- [ ] Kanban com marcos: base importada → convites enviados → ≥ X% ativação → primeiro uso → Go-Live.
- [ ] Checklist por cliente com responsável e prazo; SLA por fase com alerta.
- [ ] Importação de base de colaboradores (somente se a Fase 0 autorizar): validação de e-mail/CPF duplicado, relatório de erros.

**Entrega:** onboarding mensurável com tempo médio até o primeiro uso.

---

## Fase 4 — Renovação e relatório de valor (1–2 semanas)

- [ ] Pipeline de renovação (90/60/30 dias) com playbook por estágio.
- [ ] Previsão de churn e NRR por carteira/CSM.
- [ ] QBR automático em PDF (ativação, uso, economia total, benefícios mais usados, comparação com a média da carteira).
- [ ] Registro de interações por cliente (calls, e-mails, notas) vinculado ao calendário.

**Entrega:** o CSM chega na renovação com o relatório pronto.

---

## Fase 5 — Comunicação e campanhas com IA (1–2 semanas)

- [ ] Kits para o RH do cliente (e-mail, WhatsApp, cartaz) gerados pela IA conforme o ponto fraco (ex.: ativação baixa na filial X).
- [ ] Calendário de campanhas sazonais.
- [ ] Integração real com Google Agenda/Meet (OAuth) no lugar dos links fixos.
- [ ] Envio por e-mail transacional (Brevo/Resend) com registro da interação.

---

## Fase 6 — Rede de parceiros e LGPD (contínuo)

- [ ] Cobertura por cidade/categoria e demanda não atendida ligada ao motivo de risco.
- [ ] Log de auditoria, política de retenção, exportação/exclusão de dados, termo de uso interno.
- [ ] Monitoramento de erros (Sentry) e backup do banco.

---

## Cronograma resumido

| Fase | Duração | Acumulado |
|------|---------|-----------|
| 0 Descoberta | 3–5 dias | 1 sem |
| 1 Fundação | 1–2 sem | 3 sem |
| 2 Dados + Score | 1–2 sem | 5 sem |
| 3 Onboarding | 1 sem | 6 sem |
| 4 Renovação + QBR | 1–2 sem | 8 sem |
| 5 Campanhas | 1–2 sem | 10 sem |
| 6 Parceiros + LGPD | contínuo | — |

## Riscos principais

- **Sem fonte de dados automática**, o Health Score vira digitação manual e perde valor → resolver na Fase 0.
- **LGPD** se a base nominal de colaboradores entrar → começar com métricas agregadas.
- **Escopo**: entregar cada fase em produção antes de começar a próxima.
- **Migração**: manter o protótipo atual funcionando até a Fase 1 estar completa.

## Primeiro passo

Responder as perguntas da Fase 0 (principalmente: como sai o dado de uso da plataforma de benefícios). Com isso eu detalho o schema da Fase 1 e começo a implementação.
