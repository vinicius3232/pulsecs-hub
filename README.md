# 🚀 PulseCS — Enterprise Customer Success & Copilot Hub

Uma solução corporativa completa de **Customer Success (CSM)**, **Onboarding (IS)**, **Health Score**, **Régua Omnichannel** e **Gestão de Equipe (RH de CS)**, projetada com base nos melhores padrões arquiteturais do **`DeskcommCRM`** e do **`Cannabis-Associacao-RJ`**, equipada com suporte nativo a **Groq (LPU Ultra-Fast)**, **Google Gemini**, **OmniRoute** e ecossistema **Google Workspace**.

---

## 🌟 Módulos e Funcionalidades Principais

### 1. 📅 Calendário Operacional de Clientes (Interativo)
- **Visão Mensal & Semanal:** Grade completa de Novembro de 2026 destacando reuniões do dia ("HOJE") e chamadas futuras.
- **Pills de Reunião com Cores de Health Score:** Verde (Treinamento / QBR), Amarelo (Check-in / Alinhamento) e Vermelho (Alinhamento de Risco / Churn).
- **Modal de Detalhes da Call:** Exibe horário, empresa, contato, Health Score e **Briefing Automático do Copilot**.
- **Ações Imediatas:** Botão de 1 clique para entrar no **Google Meet** e botão para agendar diretamente no **Google Agenda**.

### 2. 💬 Central Omnichannel & Régua de Retenção CS (WhatsApp & E-mail)
- **Estúdio de Contato Inteligente:** Seleção de qualquer conta da carteira para disparo instantâneo.
- **Gatilhos Pré-configurados por IA:**
  - 🚨 *Resgate de Conta Inativa / Risco de Churn*
  - ⚙️ *Apoio para Destravar Onboarding & Carga de Dados*
  - 📊 *Convite para Reunião Estratégica Trimestral (QBR)*
  - 🎓 *Lembrete de Treinamento com Link Meet*
  - ⭐ *Reconhecimento de Sucesso & Pedido de Depoimento (NPS)*
- **Refinamento de Tom em 1 Clique:** Ajuste rápido para tom "Mais Empático" ou "Mais Direto / Executivo".
- **Disparo Direto:**
  - **WhatsApp Web:** Abre a conversa via API `wa.me` com o número do cliente e o texto formatado pronto para envio.
  - **Gmail:** Abre o cliente de e-mail com assunto contextualizado e corpo completo.
- **Fila Prioritária de Intervenção:** Lista em tempo real os clientes que mais demandam atenção no dia com botão "Disparar".

### 3. 👥 Equipe de CS & Balanceamento de Carteira ("RH de CS")
- **Gestão de Capacidade dos CSMs:** Monitoramento de 3 gestores de sucesso:
  - *Vinícius M.* (Head of CS & Enterprise)
  - *Camila Prado* (Senior CSM Mid-Market)
  - *Lucas Rocha* (CSM Onboarding & SMB)
- **Indicadores de Equipe:** MRR sob custódia, Health Score médio da carteira de cada CSM e barra de capacidade operacional (limite de contas).
- **Matriz de Atribuição Dinâmica:** Dropdown para transferir contas entre CSMs instantaneamente com atualização de métricas e persistência no `localStorage`.
- **Equilíbrio com IA (1 Clique):** Botão *"Equilibrar Carteiras com IA"* que roda um algoritmo guloso para balancear o MRR e a quantidade de contas entre todos os CSMs.

### 4. ⚡ Suporte Nativo ao Groq (Inferência Quase Instantânea)
- **Preset Groq no Seletor de IA:** Acesse o Painel Master (`admin123`) e selecione **"Groq LPU (Ultra-Fast)"**.
- **Endpoint:** `https://api.groq.com/openai/v1`
- **Modelos Recomendados:** `llama-3.3-70b-versatile` ou `llama-3.1-8b-instant`.
- O Copilot responde com latência inferior a 500ms.

### 5. 🌐 Integração Google Workspace
- **📊 Google Sheets:** Exportação com 1 clique para colar em planilhas ou envio automático via Webhook do Google Apps Script.
- **📅 Google Agenda:** Sincronização direta de reuniões e follow-ups.
- **🎥 Google Meet:** Abertura direta de salas de conferência para suporte guiado.

### 6. 🤖 Hub Universal de IA
- **Groq** (`api.groq.com/openai/v1`)
- **Google Gemini** (`generativelanguage.googleapis.com/v1beta/openai`)
- **OmniRoute Local** (`http://localhost:20128/v1`)
- **xAI / Grok** (`https://api.x.ai/v1`)
- **NVIDIA NIM** (`https://integrate.api.nvidia.com/v1`)
- **OpenAI** (`https://api.openai.com/v1`)
- **Modo Simulado Pro** (Offline 100% Funcional)

---

## ☁️ Como Fazer o Deploy Gratuito na Vercel (Passo a Passo)

1. Crie um repositório no seu GitHub (ex: `pulsecs-hub`).
2. No terminal da pasta do projeto, execute:
   ```bash
   git init
   git add .
   git commit -m "feat: PulseCS Enterprise with Calendar, Omnichannel, Team HR, Groq and Google Workspace"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/pulsecs-hub.git
   git push -u origin main
   ```
3. Acesse **[vercel.com](https://vercel.com)**, faça login com o GitHub e selecione o repositório.
4. O arquivo `vercel.json` já configurado cuidará do roteamento e dos cabeçalhos de segurança. Clique em **"Deploy"**.
5. Em segundos seu link HTTPS oficial estará ativo (ex: `https://pulsecs-hub.vercel.app`).

---

## 🔐 Senha Master Padrão
- **Senha Inicial:** `admin123` (alterável na aba de segurança do Painel Master).
