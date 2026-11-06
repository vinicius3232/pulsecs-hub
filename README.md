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
2. Abra o arquivo `index.html` em qualquer navegador ou use um servidor local:
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
