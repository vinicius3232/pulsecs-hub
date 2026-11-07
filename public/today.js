/* PulseCS — tela inicial: carteira de clientes (pedido do cliente)
 * 4 indicadores (receita em risco, clientes no verde, reuniões hoje, sem contato no mês),
 * filtros rápidos e a tabela de todos os clientes com o contato do admin, o estágio de onboarding,
 * os 4 pilares de saúde (login do admin, pagamento, contato ativo, crescimento), o score e as ações.
 *
 * buildHome() e pillars() são puros (testáveis). A tela usa o mesmo cálculo no modo demonstração
 * e no modo banco.
 *
 * ATENÇÃO: os limites dos pilares abaixo são PROVISÓRIOS (o cliente ainda não passou os critérios).
 * Estão todos em PILLAR_RULES para ajustar num lugar só.
 */
(function (root) {
  'use strict';

  const PILLAR_RULES = {
    LOGIN_OK_DAYS: 7        // admin com login em até 7 dias = verde
  };

  // Estágio exibido ao cliente (Onboarding -> Reunião 1 -> Reunião 2 -> Concluído) a partir da fase interna
  const STAGE = { 'Kickoff': 'Onboarding', 'Config & Carga': 'Reunião 1', 'Treinamento': 'Reunião 2', 'Go-Live': 'Concluído' };

  // Modo demonstração: sinais fixos por cliente (o banco real calcula tudo a partir de interactions/snapshots)
  const DEMO_SIGNALS = {
    1: { contactDays: 4, growth: 9 }, 2: { contactDays: null, growth: -12, overdue: true }, 3: { contactDays: 2, growth: 14 },
    4: { contactDays: null, growth: -8 }, 5: { contactDays: 5, growth: 3 }, 6: { contactDays: 1, growth: 6 },
    7: { contactDays: 3, growth: 11 }, 8: { contactDays: 4, growth: 7 }, 9: { contactDays: 2, growth: 5 },
    10: { contactDays: 1, growth: 12 }, 11: { contactDays: null, growth: 1 }
  };

  /** "Hoje, 11:40" -> 0 | "Ontem, 16:30" -> 1 | "Há 12 dias" -> 12 | outro -> null */
  function parseLoginDays(text) {
    const t = String(text || '');
    if (/^hoje/i.test(t)) return 0;
    if (/^ontem/i.test(t)) return 1;
    const m = /(\d+)\s*dia/i.exec(t);
    return m ? Number(m[1]) : null;
  }

  /** Une o cliente da tela com os sinais de demonstração, quando for o caso. */
  function signals(c, demo) {
    if (!demo) {
      return {
        loginDays: c.loginDays === undefined ? parseLoginDays(c.lastLogin) : c.loginDays,
        overdue: !!c.overdue,
        contacted: !!c.contactedThisMonth,
        contactDays: c.lastContactDays === undefined ? null : c.lastContactDays,
        growth: c.growthPct === undefined ? null : c.growthPct
      };
    }
    const d = DEMO_SIGNALS[c.id] || {};
    const cd = d.contactDays === undefined ? null : d.contactDays;
    return {
      loginDays: parseLoginDays(c.lastLogin),
      overdue: !!(d.overdue || c.overdue),
      contacted: cd !== null,
      contactDays: cd,
      growth: d.growth === undefined ? null : d.growth
    };
  }

  /** Os 4 pilares de saúde. ok: true (verde) | false (vermelho) | null (sem dado). */
  function pillars(c, demo) {
    const s = signals(c, demo);
    const login = s.loginDays === null
      ? { ok: false, text: 'Sem login' }
      : s.loginDays <= PILLAR_RULES.LOGIN_OK_DAYS
        ? { ok: true, text: s.loginDays === 0 ? 'Login hoje' : 'Login ' + s.loginDays + 'd' }
        : { ok: false, text: 'Sem login ' + s.loginDays + 'd' };
    const pay = s.overdue ? { ok: false, text: 'Inadimplente' } : { ok: true, text: 'Pago' };
    const contact = s.contacted
      ? { ok: true, text: s.contactDays === 0 || s.contactDays === null ? 'Contato hoje' : 'Contato ' + s.contactDays + 'd' }
      : { ok: false, text: 'Sem contato' };
    const growth = s.growth === null || s.growth === undefined
      ? { ok: null, text: 'Sem histórico' }
      : s.growth >= 0 ? { ok: true, text: '+' + s.growth + '%' } : { ok: false, text: 'Retração' };
    return [
      Object.assign({ key: 'login', label: 'Login do admin' }, login),
      Object.assign({ key: 'payment', label: 'Pagamento' }, pay),
      Object.assign({ key: 'contact', label: 'Contato ativo' }, contact),
      Object.assign({ key: 'growth', label: 'Crescimento' }, growth)
    ];
  }

  /**
   * clients: itens no formato da tela. todayEvents: eventos do calendário que caem hoje
   * ({ time:'HH:MM', company, completed }). nowTime: 'HH:MM' (no demo, '00:00' = mostra a primeira).
   */
  function buildHome({ clients, todayEvents, nowTime, demo }) {
    const rows = clients.map(c => {
      const p = pillars(c, !!demo);
      const contacted = p.find(x => x.key === 'contact').ok === true;
      return {
        id: c.id, name: c.name, contact: c.contact || 'Sem contato', email: c.email || '', phone: c.phone || '',
        stage: STAGE[c.phase] || 'Onboarding', status: c.status, hs: c.hs, mrr: c.mrr || 0,
        pillars: p, contacted
      };
    });
    const green = rows.filter(r => r.status === 'green').length;
    const events = (todayEvents || []).filter(e => !e.completed).slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const next = events.find(e => String(e.time) >= (nowTime || '00:00')) || null;
    return {
      rows,
      total: rows.length,
      counts: {
        all: rows.length,
        red: rows.filter(r => r.status === 'red').length,
        yellow: rows.filter(r => r.status === 'yellow').length,
        green,
        nocontact: rows.filter(r => !r.contacted).length
      },
      greenPct: rows.length ? Math.round((green / rows.length) * 100) : 0,
      mrrAtRisk: rows.filter(r => r.status === 'red').reduce((a, r) => a + r.mrr, 0),
      meetingsToday: events.length,
      nextMeeting: next ? { time: next.time, company: next.company } : null
    };
  }

  /** filter: all | red | yellow | green | nocontact. q: busca por cliente, contato ou e-mail. */
  function filterRows(rows, filter, q) {
    const term = String(q || '').trim().toLowerCase();
    return rows.filter(r => {
      if (filter === 'red' || filter === 'yellow' || filter === 'green') { if (r.status !== filter) return false; }
      else if (filter === 'nocontact') { if (r.contacted) return false; }
      if (!term) return true;
      return (r.name + ' ' + r.contact + ' ' + r.email).toLowerCase().includes(term);
    });
  }

  const money = v => 'R$ ' + (v >= 100000 ? (v / 1000).toFixed(0) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)));

  root.PulseTodayPure = { buildHome, filterRows, pillars, parseLoginDays, money, STAGE, PILLAR_RULES, DEMO_SIGNALS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PulseTodayPure;

  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------ tela
  const ui = { filter: 'all', q: '' };
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function kpi(label, value, note, tone) {
    const c = el('div', 'p-4 rounded-2xl bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-800');
    c.append(
      el('div', 'text-xs text-slate-500 dark:text-slate-400 font-medium', label),
      el('div', 'text-3xl font-extrabold mt-1 ' + (tone || 'text-slate-900 dark:text-white'), value),
      el('div', 'text-xs text-slate-500 dark:text-slate-400 mt-1', note)
    );
    return c;
  }

  const PILL = {
    true: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    false: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
    null: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300'
  };
  const HS_TONE = { green: 'text-emerald-700 dark:text-emerald-400', yellow: 'text-amber-700 dark:text-amber-400', red: 'text-rose-700 dark:text-rose-400' };
  const FILTERS = [
    ['all', 'Todos'], ['red', 'Críticos'], ['yellow', 'Atenção'], ['green', 'Verde'], ['nocontact', 'Sem contato no mês']
  ];

  function iconButton(label, icon, onClick, href) {
    const b = href ? el('a', '') : el('button', '');
    b.className = 'inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-darkbg-800';
    if (href) { b.href = href; b.target = '_blank'; b.rel = 'noopener noreferrer'; } else { b.type = 'button'; b.onclick = onClick; }
    b.setAttribute('aria-label', label); b.title = label;
    const i = document.createElement('i'); i.setAttribute('data-lucide', icon); i.className = 'w-4 h-4';
    b.appendChild(i);
    return b;
  }

  let model = null;

  function renderRows() {
    const tbody = document.getElementById('home-rows');
    if (!tbody || !model) return;
    // contadores dos filtros
    for (const [key, label] of FILTERS) {
      const btn = document.getElementById('home-filter-' + key);
      if (!btn) continue;
      btn.textContent = label + ' (' + model.counts[key] + ')';
      btn.setAttribute('aria-pressed', ui.filter === key ? 'true' : 'false');
      btn.className = 'px-3 py-2 rounded-xl text-xs font-medium border transition-colors ' + (ui.filter === key
        ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-500 text-brand-700 dark:text-brand-200'
        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-darkbg-800');
    }
    const list = filterRows(model.rows, ui.filter, ui.q);
    tbody.textContent = '';
    if (!list.length) {
      const tr = el('tr'); const td = el('td', 'py-10 text-center text-sm text-slate-600 dark:text-slate-300', model.total ? 'Nenhum cliente com esses filtros.' : 'Nenhum cliente cadastrado.');
      td.colSpan = 5; td.setAttribute('role', 'status'); tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    for (const r of list) {
      const tr = el('tr', 'align-top');
      const c1 = el('td', 'py-3 px-3');
      const name = el('button', 'text-left font-semibold text-slate-900 dark:text-white hover:underline', r.name);
      name.type = 'button'; name.onclick = () => root.openClientModal(r.id);
      c1.append(name, el('div', 'text-xs text-slate-600 dark:text-slate-400 mt-0.5', r.contact + (r.email ? ' (' + r.email + ')' : '')));
      const c2 = el('td', 'py-3 px-3 text-xs text-slate-800 dark:text-slate-200', r.stage);
      const c3 = el('td', 'py-3 px-3');
      const wrap = el('div', 'flex flex-wrap gap-1.5');
      for (const p of r.pillars) {
        const chip = el('span', 'px-2 py-0.5 rounded-md text-[11px] font-medium ' + PILL[String(p.ok)], p.text);
        chip.title = p.label;
        wrap.appendChild(chip);
      }
      c3.appendChild(wrap);
      const c4 = el('td', 'py-3 px-3 whitespace-nowrap');
      c4.append(el('span', 'font-bold ' + (HS_TONE[r.status] || ''), r.hs + ' / 100'));
      const c5 = el('td', 'py-3 px-3');
      const acts = el('div', 'flex items-center justify-end gap-1.5');
      acts.appendChild(iconButton('Abrir o cliente ' + r.name, 'eye', () => root.openClientModal(r.id)));
      if (r.phone) acts.appendChild(iconButton('WhatsApp de ' + r.name, 'message-circle', null, 'https://wa.me/' + String(r.phone).replace(/\D/g, '')));
      if (r.email) acts.appendChild(iconButton('E-mail para ' + r.name, 'mail', null, 'mailto:' + r.email));
      c5.appendChild(acts);
      tr.append(c1, c2, c3, c4, c5);
      tbody.appendChild(tr);
    }
    if (root.lucide) root.lucide.createIcons();
  }

  root.renderTodayTab = function () {
    const host = document.getElementById('today-content');
    if (!host) return;
    const demoMode = !(root.PulseData && root.PulseData.mode === 'db');
    const P = root.PulseData;
    const now = new Date();
    const y = demoMode ? 2026 : now.getFullYear(), m = demoMode ? 10 : now.getMonth(), d = demoMode ? 6 : now.getDate();
    const events = typeof calendarEvents !== 'undefined' ? calendarEvents : [];
    const todayEvents = events.filter(e => (P && P.eventOnDay ? P.eventOnDay(e, d, m, y) : false));
    model = buildHome({ clients, todayEvents, nowTime: demoMode ? '00:00' : hhmm(now), demo: demoMode });

    host.textContent = '';
    const grid = el('div', 'grid grid-cols-2 lg:grid-cols-4 gap-4');
    grid.append(
      kpi('Receita em risco', money(model.mrrAtRisk), model.counts.red ? (model.counts.red === 1 ? 'MRR da conta crítica' : 'MRR das ' + model.counts.red + ' contas críticas') : 'Nenhuma conta crítica', model.mrrAtRisk ? 'text-rose-700 dark:text-rose-400' : undefined),
      kpi('Clientes no verde', String(model.counts.green), 'de ' + model.total + ' contas (' + model.greenPct + '%)'),
      kpi('Reuniões agendadas hoje', String(model.meetingsToday), model.nextMeeting ? 'Próxima às ' + model.nextMeeting.time + ' (' + model.nextMeeting.company + ')' : (model.meetingsToday ? 'Todas já realizadas' : 'Nenhuma reunião hoje')),
      kpi('Sem contato no mês', String(model.counts.nocontact), model.counts.nocontact ? (model.counts.nocontact === 1 ? 'cliente sem contato neste mês' : 'clientes sem contato neste mês') : 'Todos contatados neste mês', model.counts.nocontact ? 'text-rose-700 dark:text-rose-400' : undefined)
    );
    host.appendChild(grid);

    const box = el('div', 'mt-6 bg-white dark:bg-darkbg-850 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5');
    const bar = el('div', 'flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4');
    const chips = el('div', 'flex flex-wrap gap-2');
    chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Filtrar clientes');
    for (const [key, label] of FILTERS) {
      const b = el('button', '', label); b.type = 'button'; b.id = 'home-filter-' + key;
      b.onclick = () => { ui.filter = key; renderRows(); };
      chips.appendChild(b);
    }
    const tools = el('div', 'flex items-center gap-2');
    const search = el('input', 'w-full md:w-64 px-3 py-2 rounded-xl bg-slate-50 dark:bg-darkbg-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-brand-500');
    search.type = 'search'; search.id = 'home-search'; search.value = ui.q; search.placeholder = 'Buscar cliente ou admin...';
    search.setAttribute('aria-label', 'Buscar cliente ou admin');
    search.oninput = () => { ui.q = search.value; renderRows(); };
    const add = el('button', 'px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shrink-0', '+ Novo cliente');
    add.type = 'button'; add.onclick = () => root.openNewClientModal();
    tools.append(search, add);
    bar.append(chips, tools);
    box.appendChild(bar);

    const wrap = el('div', 'overflow-x-auto');
    const table = el('table', 'w-full text-left text-xs');
    const thead = el('thead', 'border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider');
    const hr = el('tr');
    for (const [label, cls] of [['Cliente / Contato admin', ''], ['Estágio onboarding', ''], ['4 pilares de saúde', ''], ['Health score', ''], ['Ações rápidas', 'text-right']]) {
      const th = el('th', 'py-3 px-3 ' + cls, label); th.scope = 'col'; hr.appendChild(th);
    }
    thead.appendChild(hr);
    const tbody = el('tbody', 'divide-y divide-slate-100 dark:divide-slate-800/60'); tbody.id = 'home-rows';
    table.append(thead, tbody); wrap.appendChild(table); box.appendChild(wrap);
    host.appendChild(box);
    renderRows();
  };
})(typeof window !== 'undefined' ? window : globalThis);
