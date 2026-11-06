/* PulseCS — painel "Hoje" (P3)
 * O gestor abre e vê: quanto da receita está em risco, quais contas precisam de atenção, por quê,
 * e qual a próxima ação. Fecha o ciclo: a tarefa criada pelas automações é concluída aqui mesmo.
 *
 * buildToday() é puro (testável). A tela usa o mesmo cálculo no modo demonstração (sem tarefas)
 * e no modo banco (com as tarefas de csm_tasks).
 */
(function (root) {
  'use strict';

  const SEV_RANK = { critical: 0, warn: 1, info: 2 };
  const STALE_DAYS = 7;
  const MAX_PRIORITIES = 12;

  const daysBetween = (iso, now) => {
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now.getTime() - t) / 86400000));
  };

  /**
   * clients: itens no formato da tela (status, mrr, hs, riskFactors, riskReason, daysToRenewal, uuid, id, name)
   * tasks:   { id, companyUuid, title, body, severity, createdAt }  (abertas)
   */
  function buildToday({ clients, tasks, now }) {
    now = now || new Date();
    const byUuid = new Map(clients.filter(c => c.uuid).map(c => [c.uuid, c]));

    const critical = clients.filter(c => c.status === 'red');
    const mrrAtRisk = critical.reduce((a, c) => a + (c.mrr || 0), 0);

    const openTasks = tasks.slice();
    const stale = openTasks.filter(t => daysBetween(t.createdAt, now) >= STALE_DAYS);
    const criticalTasks = openTasks.filter(t => t.severity === 'critical');

    // 1) tarefas abertas: mais graves primeiro; entre iguais, a mais antiga
    const items = openTasks.map(t => {
      const c = t.companyUuid ? byUuid.get(t.companyUuid) : null;
      return {
        kind: 'task', taskId: t.id, severity: SEV_RANK[t.severity] === undefined ? 'info' : t.severity,
        title: t.title, why: t.body || '', ageDays: daysBetween(t.createdAt, now),
        companyId: c ? c.id : null, company: c ? c.name : null, mrr: c ? c.mrr : 0
      };
    });

    // 2) contas críticas SEM nenhuma tarefa aberta: o risco existe e ninguém tem ação registrada
    const withTask = new Set(openTasks.map(t => t.companyUuid).filter(Boolean));
    for (const c of critical) {
      if (c.uuid && withTask.has(c.uuid)) continue;
      items.push({
        kind: 'account', taskId: null, severity: 'critical',
        title: c.name + ' está crítica (score ' + c.hs + ')',
        why: (c.riskFactors && c.riskFactors[0]) || (c.riskReason && c.riskReason !== 'Nenhum' ? c.riskReason : 'Sem fator registrado: abra o Raio-X.'),
        ageDays: 0, companyId: c.id, company: c.name, mrr: c.mrr, noAction: true
      });
    }

    items.sort((a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
      (b.mrr || 0) - (a.mrr || 0) ||
      b.ageDays - a.ageDays);

    const renewals = clients
      .filter(c => c.daysToRenewal !== null && c.daysToRenewal !== undefined && c.daysToRenewal <= 30)
      .sort((a, b) => a.daysToRenewal - b.daysToRenewal)
      .map(c => ({ companyId: c.id, company: c.name, days: c.daysToRenewal, mrr: c.mrr, status: c.status, hs: c.hs }));

    return {
      mrrAtRisk, criticalCount: critical.length,
      openTasks: openTasks.length, criticalTasks: criticalTasks.length, staleTasks: stale.length,
      priorities: items.slice(0, MAX_PRIORITIES), hiddenPriorities: Math.max(0, items.length - MAX_PRIORITIES),
      renewals
    };
  }

  const money = v => 'R$ ' + (v >= 100000 ? (v / 1000).toFixed(0) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)));

  root.PulseTodayPure = { buildToday, money, STALE_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildToday, money };

  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------ tela
  const SEV = {
    critical: { label: 'Crítico', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300' },
    warn: { label: 'Atenção', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' },
    info: { label: 'Info', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' }
  };

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

  root.renderTodayTab = function () {
    const host = document.getElementById('today-content');
    if (!host) return;
    const db = root.PulseData && root.PulseData.mode === 'db';
    const tasks = db ? (root.PulseData.tasks || []) : [];
    const t = buildToday({ clients, tasks, now: new Date() });
    host.textContent = '';

    const grid = el('div', 'grid grid-cols-2 lg:grid-cols-4 gap-4');
    grid.append(
      kpi('Receita em risco', money(t.mrrAtRisk), t.criticalCount ? 'MRR das ' + t.criticalCount + ' contas críticas' : 'Nenhuma conta crítica', t.mrrAtRisk ? 'text-rose-700 dark:text-rose-400' : undefined),
      kpi('Contas críticas', String(t.criticalCount), 'score abaixo de 50'),
      kpi('Tarefas abertas', db ? String(t.openTasks) : '—', db ? t.criticalTasks + ' críticas' : 'as tarefas das automações aparecem com o banco conectado'),
      kpi('Paradas há +' + PulseTodayPure.STALE_DAYS + ' dias', db ? String(t.staleTasks) : '—', db ? 'ações que ninguém concluiu' : 'requer o banco conectado', db && t.staleTasks ? 'text-amber-700 dark:text-amber-400' : undefined)
    );
    host.appendChild(grid);

    // Prioridades
    const box = el('div', 'mt-6 bg-white dark:bg-darkbg-850 rounded-2xl border border-slate-200 dark:border-slate-800 p-5');
    const head = el('div', 'flex items-center justify-between mb-3');
    head.append(el('h3', 'font-bold text-sm text-slate-900 dark:text-white', 'Prioridades'), el('span', 'text-xs text-slate-500 dark:text-slate-400', t.priorities.length ? t.priorities.length + (t.hiddenPriorities ? ' de ' + (t.priorities.length + t.hiddenPriorities) : '') + ' itens' : ''));
    box.appendChild(head);

    if (!t.priorities.length) {
      box.appendChild(el('p', 'text-sm text-slate-600 dark:text-slate-300 py-6 text-center', 'Nada urgente agora. Nenhuma conta crítica e nenhuma tarefa aberta.'));
    } else {
      const ul = el('ul', 'divide-y divide-slate-100 dark:divide-slate-800');
      for (const p of t.priorities) {
        const li = el('li', 'py-3 flex flex-col sm:flex-row sm:items-start gap-3');
        const body = el('div', 'flex-1 min-w-0');
        const top = el('div', 'flex flex-wrap items-center gap-2');
        const sev = SEV[p.severity] || SEV.info;
        top.append(el('span', 'text-xs font-semibold px-2 py-0.5 rounded-md ' + sev.cls, sev.label));
        if (p.company) {
          const link = el('button', 'text-xs font-semibold underline text-brand-700 dark:text-brand-300', p.company);
          link.type = 'button';
          link.onclick = () => root.openClientModal(p.companyId);
          top.appendChild(link);
        }
        if (p.mrr) top.appendChild(el('span', 'text-xs text-slate-500 dark:text-slate-400', money(p.mrr) + '/mês'));
        if (p.kind === 'task') top.appendChild(el('span', 'text-xs ' + (p.ageDays >= PulseTodayPure.STALE_DAYS ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-slate-500 dark:text-slate-400'), p.ageDays === 0 ? 'hoje' : 'há ' + p.ageDays + ' dias'));
        body.appendChild(top);
        body.appendChild(el('div', 'mt-1 text-sm font-medium text-slate-900 dark:text-white', p.title));
        if (p.why) body.appendChild(el('div', 'text-xs text-slate-600 dark:text-slate-400 mt-0.5', p.why));
        li.appendChild(body);

        const actions = el('div', 'flex items-center gap-2 shrink-0');
        if (p.kind === 'task') {
          const done = el('button', 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700', 'Concluir');
          done.type = 'button';
          done.setAttribute('aria-label', 'Concluir tarefa: ' + p.title);
          done.onclick = async () => { done.disabled = true; await root.PulseData.completeTask(p.taskId); };
          actions.appendChild(done);
        } else {
          const open = el('button', 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-darkbg-800', 'Abrir Raio-X');
          open.type = 'button';
          open.onclick = () => root.openClientModal(p.companyId);
          actions.appendChild(open);
        }
        li.appendChild(actions);
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    host.appendChild(box);

    // Renovações em até 30 dias
    const rbox = el('div', 'mt-6 bg-white dark:bg-darkbg-850 rounded-2xl border border-slate-200 dark:border-slate-800 p-5');
    rbox.appendChild(el('h3', 'font-bold text-sm text-slate-900 dark:text-white mb-3', 'Renovam em até 30 dias'));
    if (!t.renewals.length) {
      rbox.appendChild(el('p', 'text-sm text-slate-600 dark:text-slate-300', 'Nenhuma renovação nos próximos 30 dias.'));
    } else {
      const ul = el('ul', 'divide-y divide-slate-100 dark:divide-slate-800');
      for (const r of t.renewals) {
        const li = el('li', 'py-2 flex items-center justify-between gap-3 text-sm');
        const left = el('button', 'text-left font-medium underline text-slate-900 dark:text-white', r.company);
        left.type = 'button';
        left.onclick = () => root.openClientModal(r.companyId);
        const info = el('span', 'text-xs text-slate-600 dark:text-slate-400', (r.days < 0 ? 'venceu há ' + Math.abs(r.days) + ' dias' : r.days === 0 ? 'vence hoje' : 'em ' + r.days + ' dias') + ' · ' + money(r.mrr) + '/mês · score ' + r.hs);
        li.append(left, info);
        ul.appendChild(li);
      }
      rbox.appendChild(ul);
    }
    host.appendChild(rbox);
  };
})(typeof window !== 'undefined' ? window : globalThis);
