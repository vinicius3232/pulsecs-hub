# PulseCS — Roadmap enxuto (substitui o escopo de fases do PLANO_DESENVOLVIMENTO.md)

Motivo: a UI foi simplificada (PR 1) e o sistema terá **um único usuário (o Head)**. Continuam valendo as regras de trabalho e os comandos de verificação do `PLANO_DESENVOLVIMENTO.md` (seções 2 e 3).

## Telas que existem
Hoje · Dashboard (carteira) · Calendário · Clientes em risco · Onboarding · Automações · Lembretes · Configurações (Head) · **Privacidade (nova, ver Fase L)**.
Removidas: Relatórios/QBR, Renovação, Parceiros, Campanhas, Central Omnichannel, Equipe.

## Decisões do usuário
- **Manter** "Receita em risco" na aba Hoje (é o único número de receita que sobra; não voltar com MRR/NRR no Dashboard).
- **Criar a parte de LGPD** como tela e rotina próprias (Fase L).

## Fases (em ordem)

### Fase A — Ligar o Supabase real  ✅ entregue na branch `feat/dev-fase-a-bootstrap`
Falta só o usuário rodar `scripts/smoke-real.mjs` contra um projeto de teste.

### Fase B — Dados reais e calibração  🟡 entregue com 3 falhas a corrigir
Antes do merge de `feat/dev-fase-b-ingest-health-config`:
1. `health_config` precisa ser lida pelo recálculo (hoje a calibração não afeta o score).
2. `unmatched_metrics`: só o Head resolve; `viewer`/outros não editam.
3. Fila sem correspondência: guardar só números validados, deduplicar, limitar tamanho e retenção, e ter como reaplicar (função do Head).
Correção já escrita em parte (migration `0008`, API e cron); faltam testes novos, `schema.sql` e rodar tudo.

### Fase C — Lembretes no banco (era C1; o resto da fase C foi cancelado)
- Tabela `reminders` (empresa opcional, data, feito) com RLS e teste.
- Ligar a aba Lembretes ao banco; manter o modo demonstração.
- Cancelados: C2 Relatórios/QBR, C3 Campanhas/régua, C4 Parceiros, E3 resumo de QBR, D2 envio real de mensagens (só volta se você pedir).
- C5 (histórico de receita) fica no fim da fila; só se voltar a precisar de receita ao longo do tempo.

### Fase D — Automações (continua)
- D1 Editor de regras (criar/editar/clonar; validação no servidor; só o Head).
- D3 Entrega sem repetição para `add_note` e `http_request` (chave por execução+passo).
- D4 Saúde do sistema: fila de eventos, eventos mortos e atrasos, visíveis ao Head; alerta quando passar de um limite.

### Fase L — LGPD e privacidade (nova)
Objetivo: cumprir o básico da LGPD para os dados pessoais dos contatos dos clientes (nome, e-mail, telefone) e dos colaboradores citados.
- **L1 Inventário:** documento `docs/lgpd-inventario.md` com cada tabela/coluna que guarda dado pessoal, finalidade, base legal (a definir com o usuário/jurídico) e prazo de retenção.
- **L2 Direitos do titular:** tabela `data_requests` (tipo: acesso, correção, exclusão, portabilidade; titular; data do pedido; prazo de 15 dias; status; quem atendeu) e funções do Head para **exportar** (JSON/CSV) e **anonimizar/excluir** os dados de uma pessoa em `contacts`, `interactions` e demais tabelas, com resumo do que foi feito.
- **L3 Tela "Privacidade"** (só o Head): lista de pedidos com prazo, botão exportar, botão excluir com confirmação e prévia do que será apagado; registro de cada ação.
- **L4 Retenção automática:** rotina no cron que apaga/anonimiza o que passou do prazo (interações antigas, filas, entregas de webhook), com contagem no log.
- **L5 Trilha de auditoria:** tabela `audit_log` (quem, quando, o quê) para leitura/alteração de dado pessoal e para as ações da tela Privacidade; imutável (só INSERT).
- **L6 Minimização:** conferir que `payload` de filas e logs não guardam dado pessoal além do necessário; logs sem e-mail/telefone.
- Testes: RLS (só o Head), exportação completa, exclusão remove tudo e nada além, retenção apaga só o vencido, auditoria registra.
- Fora do escopo do agente: texto da política de privacidade, base legal final e revisão jurídica (ficam com o usuário).

### Fase E — IA e previsão (só depois de dados reais e 3 meses de histórico)
- E1 Copilot com contexto real, sem dados pessoais de colaboradores; cita a origem de cada afirmação.
- E2 Previsão de churn explicável, medida contra o churn real antes de qualquer modelo.

### Fase F — Produção
- F1 Sentry sem dados pessoais. F2 Backup + teste de restauração real. F4 CI (já criado na Fase A; deve rodar a seção 3).
- F5 CSP mais estrita, depois de compilar o Tailwind (plano de UI, Onda 4).
- F3 deixou de existir como item: foi absorvido pela Fase L.

### Limpeza técnica (pequena, a qualquer momento)
- Apagar do `index.html` o código sem uso das abas removidas (`renderRenewalTab`, `renderTeamTab`, `renderOmnichannelTab`, `renderCampaignsTab`, `renderPartnersTab` e auxiliares).
- Com um só usuário: manter a RLS e os testes por papel (segurança), mas não investir em telas por papel.

## Ordem sugerida
1. Fechar a Fase B (3 correções) e fazer o merge de A e B.
2. Usuário liga o Supabase real e roda o smoke (Fase A).
3. Fase C (Lembretes) e Fase L (LGPD) em paralelo.
4. Fase D.
5. Fase F.
6. Fase E, quando houver dados.

## Perguntas em aberto para o usuário
- Base legal e prazos de retenção por tipo de dado (L1/L4).
- Quem recebe os pedidos de titulares (canal e e-mail) e como o pedido chega ao sistema (L2).
- Como a plataforma de benefícios entrega os dados de uso (confirmado: API/webhook em `/api/ingest/metrics`).
