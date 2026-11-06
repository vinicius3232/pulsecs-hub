# 🎨 PulseCS — Design System & Craft Specification (`DESIGN.md`)

*Gerado com base na tríade `impeccable document` + `ui-ux-pro-max` + `taste-skill`.*

---

## 🏛️ 1. Princípios de Direção de Arte Anti-Slop (TasteSkill v2)
1. **Sem "AI Slop" Visual:**
   - Proibido o uso de gradientes roxos genéricos lavados ou fundos pretos chapados sem profundidade.
   - Proibido o uso de sombras difusas caóticas. A profundidade é construída via superfícies em camadas (`bg-slate-900/80` com `backdrop-blur-md`) e iluminação de borda sutil (*subtle rim lighting* / `border border-white/10`).
2. **Ritmo & Densidade de Informação (Data-Dense Craft):**
   - Espaçamentos consistentes baseados no grid de 4px/8px do Tailwind.
   - Informações financeiras e métricas de vidas renderizadas com alinhamento mono-espaçado (`font-mono tabular-nums`) para comparação visual sem deslocamento de largura.
3. **Piso de Qualidade Impeccable (Craft Floor):**
   - Todo botão com ícone exclusivo possui `aria-label` descritivo.
   - Piso de legibilidade: nenhuma fonte de texto corrido abaixo de 12px; rótulos auxiliares travados no piso de 11px.
   - Suporte estrito a `prefers-reduced-motion: reduce`.

---

## 🎨 2. Paleta de Cores Semântica (Obsidian Slate & Emerald Pro)

```
CANVAS BASE (Deep Obsidian):
- Fundo Canvas (Dark):    #030712 (darkbg-950)
- Superfície de Cartão:   #0f172a (darkbg-900 / slate-900)
- Superfície Elevada:     #1e293b (darkbg-850 / slate-800)
- Bordas Primárias:       rgba(255, 255, 255, 0.08) (slate-800/80)
- Bordas Hover / Destaque: rgba(255, 255, 255, 0.16) (slate-700)

ACENTOS SEMÂNTICOS DE ADOÇÃO:
- Saudável / Ativado (Emerald): #10b981 (emerald-500) | Badge: rgba(16, 185, 129, 0.15)
- Atenção / Setup (Amber):       #f59e0b (amber-500)   | Badge: rgba(245, 158, 11, 0.15)
- Risco / Churn (Rose):          #f43f5e (rose-500)    | Badge: rgba(244, 63, 94, 0.15)
- Adoção / Economia (Indigo):    #6366f1 (indigo-500)  | Badge: rgba(99, 102, 241, 0.15)
- Inteligência / Copilot (Sky):  #0ea5e9 (sky-500)     | Glow: shadow-indigo-500/25
```

---

## 🔤 3. Tipografia & Escala de Hierarquia

| Nível | Família | Tamanho | Peso | Aplicação |
| :--- | :--- | :--- | :--- | :--- |
| **Display H1** | Sans (System / Plus Jakarta) | `24px (1.5rem)` | 800 (Extrabold) | Título de Seção Principal & KPIs Globais |
| **Section H2** | Sans | `18px (1.125rem)` | 700 (Bold) | Cabeçalho de Módulos (Renovação, Kanban) |
| **Card H3** | Sans | `14px (0.875rem)` | 600 (Semibold) | Título de Cartão e Nome de Empresa |
| **Body Base** | Sans | `13px - 14px` | 400 - 500 | Texto corrido, notas de atendimento |
| **Meta / Label** | Sans | `11px - 12px` | 600 (Semibold) | Badges de status, tags de SLA, estágios |
| **Data / Numbers** | Mono (Tabular) | `13px - 28px` | 700 (Bold) | Valores R$, percentuais de MAU e datas |

---

## ♿ 4. Acessibilidade (WCAG 2.1 AA) & Responsividade Mobile

1. **Navegação por Teclado:**
   - Link de salto direto (`.skip-link`): `"Pular para o conteúdo"`.
   - Anel de foco nítido `:focus-visible` (`outline: 2px solid #818cf8; outline-offset: 2px`).
   - Todos os elementos com `onclick` convertidos para `role="button"` com ativação em `Enter` e `Espaço`.
2. **Modais Acessíveis & Focus Trap:**
   - Modais com atributos `role="dialog"` e `aria-modal="true"`.
   - Retenção de foco circular (Tab / Shift+Tab) dentro do modal ativo.
   - Retorno automático do foco para o elemento disparador ao fechar o diálogo.
3. **Ergonomia Mobile & Alvos de Toque:**
   - Menu lateral em gaveta deslizante (`#sidebar` com `#sidebar-backdrop` e botão hambúrguer `#btn-open-menu`).
   - Alvos de toque em telas móveis e ponteiros táteis padronizados em `min-height: 40px` e `min-width: 40px`.
