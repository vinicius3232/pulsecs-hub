/* PulseCS — aba Automações
 * Lista as regras de forma legível (QUANDO / SE / ENTÃO), mostra as execuções recentes (só o Head vê),
 * permite ativar/desativar (Head) e executar manualmente uma regra "manual.run" para uma empresa.
 * A criação/edição de passos continua por SQL: JSON editado à mão na tela seria um risco maior que o benefício.
 */
(function (root) {
  'use strict';

  const TRIGGERS = {
    'company.created': 'Empresa criada',
    'company.health_changed': 'Saúde da empresa mudou',
    'company.phase_changed': 'Fase da empresa mudou',
    'company.renewal_due': 'Renovação se aproximando (90/60/30 dias)',
    'company.rh_inactive': 'RH sem login há 14+ dias',
    'manual.run': 'Execução manual'
  };
  const FIELDS = {
    'event.to': 'novo valor', 'event.from': 'valor anterior', 'event.score_to': 'novo score', 'event.bucket': 'faixa de renovação',
    'event.days_to_renewal': 'dias para renovar', 'event.days_since_login': 'dias sem login',
    'company.health_score': 'score', 'company.health_status': 'saúde', 'company.activation_rate': 'ativação (%)', 'company.mau_rate': 'MAU (%)',
    'company.phase': 'fase', 'company.tier': 'plano', 'company.mrr': 'MRR'
  };
  const OPS = { eq: '=', neq: '≠', contains: 'contém', gt: '>', gte: '≥', lt: '<', lte: '≤' };
  const SEVERITY = { critical: 'crítica', warn: 'atenção', info: 'info' };
  const RUN_STATUS = {
    success: { label: 'Concluída', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' },
    partial: { label: 'Parcial', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' },
    failed: { label: 'Falhou', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300' },
    waiting: { label: 'Aguardando espera', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' }
  };

  const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  const triggerLabel = ev => TRIGGERS[ev] || ev;

  function describeCondition(c) {
    if (!c || typeof c !== 'object') return '?';
    return (FIELDS[c.field] || String(c.field)) + ' ' + (OPS[c.op] || String(c.op)) + ' ' + cut(c.value, 40);
  }

  function describeConditions(list) {
    return Array.isArray(list) && list.length ? list.map(describeCondition).join(' e ') : 'sempre';
  }

  function hostOf(url) {
    try { return new URL(String(url).replace(/\{\{[^}]*\}\}/g, 'x')).hostname; } catch (e) { return 'endereço inválido'; }
  }

  function describeStep(step, depth) {
    depth = depth || 0;
    if (!step || typeof step !== 'object') return '?';
    const c = step.config || {};
    switch (step.type) {
      case 'create_task': return 'Criar tarefa (' + (SEVERITY[c.severity] || 'atenção') + '): "' + cut(c.title, 70) + '"';
      case 'add_note': return 'Registrar nota na linha do tempo: "' + cut(c.content, 60) + '"';
      case 'http_request': return 'Chamar ' + hostOf(c.url) + ' (' + (c.method === 'GET' ? 'GET' : 'POST') + ')';
      case 'delay': {
        const parts = [];
        if (Number(c.days) > 0) parts.push(Number(c.days) + (Number(c.days) === 1 ? ' dia' : ' dias'));
        if (Number(c.hours) > 0) parts.push(Number(c.hours) + (Number(c.hours) === 1 ? ' hora' : ' horas'));
        return 'Aguardar ' + (parts.join(' e ') || 'tempo inválido');
      }
      case 'if': {
        if (depth >= 3) return 'Se …';
        const then = (c.then || []).map(s => describeStep(s, depth + 1)).join('; ') || 'nada';
        const els = (c.else || []).map(s => describeStep(s, depth + 1)).join('; ');
        return 'Se ' + describeConditions(c.conditions) + ': ' + then + (els ? ' · senão: ' + els : '');
      }
      default: return 'Passo desconhecido (' + cut(step.type, 30) + ')';
    }
  }

  const describeSteps = steps => (Array.isArray(steps) ? steps : []).map((s, i) => (i + 1) + '. ' + describeStep(s));

  function mapRule(r) {
    return {
      id: r.id, name: String(r.name || ''), trigger: r.trigger_event, active: !!r.is_active,
      conditions: Array.isArray(r.conditions) ? r.conditions : [], actions: Array.isArray(r.actions) ? r.actions : [],
      runCount: Number(r.run_count) || 0, lastRunAt: r.last_run_at || null
    };
  }

  const pure = { triggerLabel, describeCondition, describeConditions, describeStep, describeSteps, mapRule, RUN_STATUS, TRIGGERS };
  root.PulseAutomationsPure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------ tela
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const when = iso => { if (!iso) return 'nunca'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'nunca' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); };

  const state = { rules: [], runs: [], loaded: false, loading: false, error: null };

  async function load() {
    const sb = root.PulseAuth && root.PulseAuth.client;
    if (!sb) return;
    state.loading = true; state.error = null; render();
    try {
      const [rules, runs] = await Promise.all([
        sb.from('automation_rules').select('*').order('name'),
        // A RLS só devolve execuções ao Head; para os demais a lista vem vazia
        sb.from('automation_rule_runs').select('id, rule_id, status, created_at').order('created_at', { ascending: false }).limit(20)
      ]);
      if (rules.error) throw new Error(rules.error.message);
      state.rules = (rules.data || []).map(mapRule);
      state.runs = runs.error ? [] : (runs.data || []);
      state.loaded = true;
    } catch (e) {
      state.error = e.message;
    }
    state.loading = false;
    render();
  }

  async function toggle(rule, active) {
    const sb = root.PulseAuth.client;
    const { data, error } = await sb.from('automation_rules').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', rule.id).select('id');
    if (error || !data || !data.length) {
      root.showToast('Não foi possível alterar a regra' + (error ? ': ' + error.message : ' (somente o Head pode)'), 'error');
    } else {
      rule.active = active;
      root.showToast('Regra "' + rule.name + '" ' + (active ? 'ativada' : 'desativada') + '.', 'success');
    }
    render();
  }

  async function runManual(rule, companyUuid, btn) {
    const token = root.PulseAuth && root.PulseAuth.token();
    if (!token) { root.showToast('Faça login para executar regras.', 'warning'); return; }
    if (!companyUuid) { root.showToast('Escolha uma empresa.', 'warning'); return; }
    btn.disabled = true;
    try {
      const res = await fetch('/api/automation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ rule_id: rule.id, company_id: companyUuid })
      });
      const msg = { 200: 'Regra executada.', 401: 'Sessão expirada. Entre novamente.', 403: 'Você não pode executar para esta empresa.', 404: 'Regra manual ou empresa não encontrada.', 429: 'Muitas execuções. Aguarde um minuto.' }[res.status] || ('Falha ao executar (HTTP ' + res.status + ').');
      root.showToast(msg, res.ok ? 'success' : 'error');
      if (res.ok) { if (root.PulseData && root.PulseData.load) await root.PulseData.load(); await load(); }
    } catch (e) {
      root.showToast('Sem conexão com o servidor.', 'error');
    }
    btn.disabled = false;
  }

  function ruleCard(rule, isHead) {
    const card = el('div', 'p-4 rounded-2xl bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-800 space-y-3');
    const head = el('div', 'flex items-start justify-between gap-3');
    const title = el('div', 'min-w-0');
    title.append(el('div', 'font-semibold text-sm text-slate-900 dark:text-white', rule.name),
      el('div', 'text-xs text-slate-500 dark:text-slate-400 mt-0.5', 'Quando: ' + triggerLabel(rule.trigger)));
    head.appendChild(title);

    const sw = el('label', 'flex items-center gap-2 text-xs shrink-0 ' + (isHead ? 'cursor-pointer' : 'opacity-60'));
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = rule.active; cb.disabled = !isHead;
    cb.setAttribute('aria-label', 'Regra ativa: ' + rule.name);
    cb.onchange = () => toggle(rule, cb.checked);
    sw.append(cb, el('span', 'text-slate-700 dark:text-slate-300', rule.active ? 'Ativa' : 'Desativada'));
    sw.title = isHead ? '' : 'Somente o Head altera regras';
    head.appendChild(sw);
    card.appendChild(head);

    card.appendChild(el('div', 'text-xs text-slate-600 dark:text-slate-400', 'Se: ' + describeConditions(rule.conditions)));
    const ol = el('ol', 'text-xs text-slate-700 dark:text-slate-300 space-y-0.5 list-none');
    for (const line of describeSteps(rule.actions)) ol.appendChild(el('li', '', line));
    card.append(el('div', 'text-xs font-semibold text-slate-700 dark:text-slate-300', 'Então:'), ol);

    const foot = el('div', 'flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800');
    foot.appendChild(el('span', 'text-xs text-slate-500 dark:text-slate-400', rule.runCount + ' execuções · última: ' + when(rule.lastRunAt)));
    if (isHead) {
      const actionsBox = el('div', 'flex items-center gap-1.5 text-xs');
      const btnEdit = el('button', 'px-2 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-darkbg-800 font-medium', 'Editar');
      btnEdit.type = 'button';
      btnEdit.onclick = () => { if (root.PulseRulesEditor) root.PulseRulesEditor.open(rule); };

      const btnClone = el('button', 'px-2 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-darkbg-800 font-medium', 'Clonar');
      btnClone.type = 'button';
      btnClone.onclick = () => { if (root.PulseRulesEditor) root.PulseRulesEditor.clone(rule); };

      const btnDel = el('button', 'px-2 py-1 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-medium', 'Excluir');
      btnDel.type = 'button';
      btnDel.onclick = () => { if (root.PulseRulesEditor) root.PulseRulesEditor.delete(rule); };

      actionsBox.append(btnEdit, btnClone, btnDel);
      foot.appendChild(actionsBox);
    }
    if (rule.trigger === 'manual.run' && rule.active) {
      const box = el('div', 'flex items-center gap-2');
      const sel = el('select', 'px-2 py-1 rounded-lg text-xs bg-slate-50 dark:bg-darkbg-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200');
      sel.setAttribute('aria-label', 'Empresa para executar a regra');
      const first = el('option', '', 'Empresa…'); first.value = ''; sel.appendChild(first);
      for (const c of clients) if (c.uuid) { const o = el('option', '', c.name); o.value = c.uuid; sel.appendChild(o); }
      const btn = el('button', 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700', 'Executar agora');
      btn.type = 'button';
      btn.onclick = () => runManual(rule, sel.value, btn);
      box.append(sel, btn);
      foot.appendChild(box);
    }
    card.appendChild(foot);
    return card;
  }

  function render() {
    const host = document.getElementById('automations-content');
    if (!host) return;
    host.textContent = '';
    const db = root.PulseData && root.PulseData.mode === 'db';
    if (!db) {
      host.appendChild(el('div', 'p-4 rounded-xl text-sm border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300', 'As automações rodam no servidor. Conecte o banco (login) para ver, ativar e executar as regras.'));
      return;
    }
    if (state.loading && !state.loaded) { host.appendChild(el('p', 'text-sm text-slate-500 dark:text-slate-400', 'Carregando regras…')); return; }
    if (state.error) {
      const p = el('p', 'text-sm text-rose-700 dark:text-rose-400', 'Não foi possível carregar as regras (' + state.error + '). ');
      const b = el('button', 'underline', 'Tentar de novo'); b.type = 'button'; b.onclick = load; p.appendChild(b);
      host.appendChild(p); return;
    }
    const isHead = root.PulseAuth.role() === 'head';
    if (isHead) {
      const topBar = el('div', 'flex items-center justify-between mb-4');
      topBar.appendChild(el('span', 'text-xs text-slate-500 dark:text-slate-400', state.rules.length + ' regras configuradas'));
      const newBtn = el('button', 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 transition shadow-sm', '+ Nova regra');
      newBtn.type = 'button';
      newBtn.onclick = () => { if (root.PulseRulesEditor) root.PulseRulesEditor.open(); };
      topBar.appendChild(newBtn);
      host.appendChild(topBar);
    }
    const list = el('div', 'grid grid-cols-1 xl:grid-cols-2 gap-4');
    if (!state.rules.length) list.appendChild(el('p', 'text-sm text-slate-500 dark:text-slate-400', 'Nenhuma regra cadastrada.'));
    for (const r of state.rules) list.appendChild(ruleCard(r, isHead));
    host.appendChild(list);

    const box = el('div', 'mt-6 bg-white dark:bg-darkbg-850 rounded-2xl border border-slate-200 dark:border-slate-800 p-5');
    box.appendChild(el('h3', 'font-bold text-sm text-slate-900 dark:text-white mb-3', 'Execuções recentes'));
    if (!isHead) box.appendChild(el('p', 'text-sm text-slate-500 dark:text-slate-400', 'O histórico de execuções é visível apenas para o Head.'));
    else if (!state.runs.length) box.appendChild(el('p', 'text-sm text-slate-500 dark:text-slate-400', 'Nenhuma execução ainda.'));
    else {
      const names = new Map(state.rules.map(r => [r.id, r.name]));
      const ul = el('ul', 'divide-y divide-slate-100 dark:divide-slate-800');
      for (const run of state.runs) {
        const li = el('li', 'py-2 flex items-center justify-between gap-3 text-sm');
        const st = RUN_STATUS[run.status] || RUN_STATUS.failed;
        li.append(el('span', 'text-slate-800 dark:text-slate-200', names.get(run.rule_id) || 'Regra removida'),
          el('span', 'text-xs px-2 py-0.5 rounded-md font-semibold ' + st.cls, st.label),
          el('span', 'text-xs text-slate-500 dark:text-slate-400', when(run.created_at)));
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    host.appendChild(box);
  }

  root.renderAutomationsTab = function () {
    if (root.PulseData && root.PulseData.mode === 'db' && !state.loaded && !state.loading) load();
    else render();
  };
  root.resetAutomations = function () { state.loaded = false; state.rules = []; state.runs = []; };
})(typeof window !== 'undefined' ? window : globalThis);
