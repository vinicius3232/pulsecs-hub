# 🚀 Guia de Bootstrap do Supabase Real (PulseCS)

Este documento descreve o procedimento operacional padrão para provisionar o banco de dados Supabase real para o **PulseCS**, configurando autenticação, controle de acesso baseado em papel (RBAC), Row-Level Security (RLS) e chaves de ambiente.

---

## 📋 Pré-requisitos
- Conta ativa no [Supabase](https://supabase.com).
- Projeto criado no Supabase (região recomendada: `sa-east-1` São Paulo para menor latência).
- Acesso ao painel do Supabase com permissão de administrador.

---

## 1. Execução dos Scripts SQL (Ordem Obrigatória)

No painel do seu projeto Supabase, acesse **SQL Editor** > **New Query** e execute os arquivos na ordem estrita abaixo (copie e cole o conteúdo de cada um):

1. `supabase/schema.sql`  
   *Cria as tabelas fundamentais (`csm_users`, `companies`, `contacts`, `meetings`, `tasks`, `revenue_snapshots`), constraints e tipos.*

2. `supabase/migrations/0002_event_log_automation.sql`  
   *Cria a fila durável `event_log`, tabela `automation_rules`, `pending_events` e triggers de evento.*

3. `supabase/migrations/0003_workflow_steps_and_views.sql`  
   *Cria tabelas de views salvas e definições de etapas.*

4. `supabase/migrations/0004_rls_by_role.sql`  
   *Ativa RLS obrigatória e define as funções auxiliares `fn_current_csm()`, `fn_is_head()`, etc., isolando dados por papel (`head`, `csm`, `is`, `viewer`).*

5. `supabase/migrations/0005_health_score_server.sql`  
   *Instala o motor matemático do Health Score dentro do PostgreSQL e os triggers de proteção.*

6. `supabase/migrations/0006_webhook_idempotency.sql`  
   *Cria a tabela de `webhook_deliveries` protegida contra reenvios duplicados da Salez ou de integrações externas.*

7. *(Opcional para Homologação)* `supabase/seed.sql`  
   *Popula a base com carteira demonstrativa de clientes, tarefas e contatos.*

---

## 2. Configurações de Segurança e Autenticação (Auth)

No menu lateral do Supabase:

### A. Desativar Cadastro Aberto (Sign-up Público)
1. Vá em **Authentication** > **Providers** > **Email**.
2. **Desmarque** a opção **"Allow new users to sign up"** (Permitir novos cadastros).
   > *Motivo:* O PulseCS é um hub corporativo interno. Apenas a administração cria usuários. Se um usuário se cadastrar sem convite, a RLS bloqueará 100% dos dados, mas desligar o cadastro fecha a porta de entrada.
3. Certifique-se de que **"Confirm email"** esteja ativado ou desativado conforme a política da sua empresa.

### B. Criação dos Usuários Iniciais da Equipe
1. Vá em **Authentication** > **Users** > **Add user** > **Create user**.
2. Crie os usuários para os membros da sua equipe (exemplo: `head@empresa.com`, `csm1@empresa.com`).
3. Guarde o `User UID` gerado para cada usuário.

### C. Vinculação de Papéis (`csm_users`)
No **SQL Editor**, vincule o `auth.uid()` gerado ao registro correspondente na tabela `public.csm_users`:

```sql
-- Exemplo para o Head de CS:
INSERT INTO public.csm_users (auth_id, name, email, role, avatar_initials, color)
VALUES (
  'SEU_USER_UID_AQUI',
  'Diretor de CS',
  'head@empresa.com',
  'head',
  'DC',
  'indigo'
)
ON CONFLICT (email) DO UPDATE
SET auth_id = EXCLUDED.auth_id,
    role = 'head';

-- Exemplo para um CSM:
INSERT INTO public.csm_users (auth_id, name, email, role, avatar_initials, color)
VALUES (
  'SEU_USER_UID_AQUI',
  'Ana Carolina',
  'csm1@empresa.com',
  'csm',
  'AC',
  'emerald'
)
ON CONFLICT (email) DO UPDATE
SET auth_id = EXCLUDED.auth_id,
    role = 'csm';
```

> **Valores válidos para `role`:**
> - `'head'`: Acesso irrestrito a todas as empresas, regras de automação, logs de eventos e reatribuição de carteira.
> - `'csm'`: Visualiza toda a carteira, mas edita apenas as contas sob sua gestão direta ou sem gestor.
> - `'is'`: Specialist de onboarding; atualiza progresso de marcos sem alterar valores de contrato ou Go-Live.
> - `'viewer'`: Acesso estritamente somente-leitura.

---

## 3. Coleta de Chaves e Configuração de Ambiente

No painel do Supabase, acesse **Project Settings** > **API**:

| Chave no Supabase | Variável de Ambiente Backend | Onde Configurar |
| :--- | :--- | :--- |
| **Project URL** | `SUPABASE_URL` | Vercel (`Settings > Environment Variables`) |
| **anon (public)** | `SUPABASE_ANON_KEY` | Vercel & `public/config.js` |
| **service_role (secret)** | `SUPABASE_SERVICE_ROLE_KEY` | Vercel *(NUNCA expor no frontend)* |

### Configuração do Frontend (`public/config.js`)
Para ativar o modo banco no navegador, edite o arquivo local ou na hospedagem:
```javascript
// public/config.js
window.PULSECS_CONFIG = {
  supabaseUrl: 'https://seu-projeto.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};
```
*(Se estas chaves estiverem vazias, o PulseCS opera automaticamente em Modo Demonstração offline).*

---

## 4. Validação Automatizada (Smoke Test)

Após configurar as chaves de teste em um arquivo local ou terminal, execute o script de fumaça:

```bash
# Definir variáveis temporárias para o teste
$env:SUPABASE_URL="https://seu-projeto.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."
$env:SUPABASE_ANON_KEY="eyJhbGciOi..."

# Rodar a validação
node scripts/smoke-real.mjs
```

O script validará automaticamente:
- Conexão e integridade de schema.
- Restrições da RLS com usuário anônimo.
- Isolamento de permissões por papel.
- Execução segura do motor de eventos e reconciliação.
