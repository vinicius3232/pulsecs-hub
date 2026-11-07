/* PulseCS — Editor de Regras de Automação
 * Permite ao Head criar, editar, clonar e excluir regras.
 * Validação rigorosa no servidor (/api/automation/rules); o editor apenas facilita a montagem do payload.
 */
(function (root) {
  'use strict';

  const TRIGGERS = [
    { id: 'company.created', label: 'Empresa criada' },
    { id: 'company.health_changed', label: 'Saúde da empresa mudou' },
    { id: 'company.phase_changed', label: 'Fase da empresa mudou' },
    { id: 'company.renewal_due', label: 'Renovação se aproximando (90/60/30 dias)' },
    { id: 'company.rh_inactive', label: 'RH sem login há 14+ dias' },
    { id: 'manual.run', label: 'Execução manual' }
  ];

  const COMMON_FIELDS = [
    { id: 'company.health_score', label: 'Score de saúde (0-100)' },
    { id: 'company.health_status', label: 'Status de saúde (green, yellow, red)' },
    { id: 'company.phase', label: 'Fase da empresa' },
    { id: 'company.tier', label: 'Plano/Tier' },
    { id: 'company.mrr', label: 'MRR da empresa' },
    { id: 'company.activation_rate', label: 'Taxa de ativação (%)' },
    { id: 'company.mau_rate', label: 'Taxa de MAU (%)' },
    { id: 'event.to', label: 'Novo valor do evento' },
    { id: 'event.from', label: 'Valor anterior do evento' },
    { id: 'event.bucket', label: 'Faixa de renovação (30, 60, 90)' },
    { id: 'event.days_since_login', label: 'Dias sem login do RH' }
  ];

  const OPERATORS = [
    { id: 'eq', label: '= (igual)' },
    { id: 'neq', label: '≠ (diferente)' },
    { id: 'contains', label: 'contém' },
    { id: 'gt', label: '> (maior que)' },
    { id: 'gte', label: '≥ (maior ou igual)' },
    { id: 'lt', label: '< (menor que)' },
    { id: 'lte', label: '≤ (menor ou igual)' }
  ];

  const ACTION_TYPES = [
    { id: 'create_task', label: 'Criar tarefa para o CSM' },
    { id: 'add_note', label: 'Registrar nota na linha do tempo' },
    { id: 'http_request', label: 'Chamar webhook / HTTP' },
    { id: 'delay', label: 'Aguardar tempo (delay)' },
    { id: 'if', label: 'Condicional (Se / Então)' }
  ];

  function cloneRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    return {
      name: 'Cópia de ' + (rule.name || 'Nova Regra'),
      trigger_event: rule.trigger || rule.trigger_event || 'company.health_changed',
      is_active: false, // cópia nasce inativa por segurança
      conditions: JSON.parse(JSON.stringify(rule.conditions || [])),
      actions: JSON.parse(JSON.stringify(rule.actions || []))
    };
  }

  function validateEditorState(state) {
    const errors = [];
    if (!state || typeof state !== 'object') {
      return { valid: false, errors: ['Estado do formulário inválido'] };
    }
    const name = String(state.name || '').trim();
    if (!name) errors.push('Nome da regra é obrigatório.');
    if (name.length > 100) errors.push('Nome da regra excede 100 caracteres.');

    const trigger = String(state.trigger_event || '').trim();
    if (!trigger) errors.push('Gatilho é obrigatório.');

    if (!Array.isArray(state.actions) || state.actions.length === 0) {
      errors.push('A regra deve ter pelo menos um passo (ação).');
    } else if (state.actions.length > 10) {
      errors.push('A regra pode ter no máximo 10 passos na raiz.');
    }

    return { valid: errors.length === 0, errors };
  }

  function buildRulePayload(state) {
    return {
      name: String(state.name || '').trim(),
      trigger_event: String(state.trigger_event || '').trim(),
      is_active: Boolean(state.is_active),
      conditions: (Array.isArray(state.conditions) ? state.conditions : []).map(c => ({
        field: String(c.field || '').trim(),
        op: String(c.op || 'eq').trim(),
        value: String(c.value !== undefined ? c.value : '').trim()
      })),
      actions: (Array.isArray(state.actions) ? state.actions : []).map(cleanAction)
    };
  }

  function cleanAction(action) {
    if (!action || typeof action !== 'object') return { type: 'unknown' };
    const type = String(action.type || '').trim();
    const config = action.config || {};

    switch (type) {
      case 'create_task':
        return {
          type: 'create_task',
          config: {
            title: String(config.title || '').trim(),
            severity: String(config.severity || 'warn').trim(),
            ...(config.body ? { body: String(config.body).trim() } : {})
          }
        };
      case 'add_note':
        return {
          type: 'add_note',
          config: {
            content: String(config.content || '').trim()
          }
        };
      case 'http_request':
        return {
          type: 'http_request',
          config: {
            url: String(config.url || '').trim(),
            method: config.method === 'GET' ? 'GET' : 'POST',
            ...(config.body ? { body: config.body } : {})
          }
        };
      case 'delay':
        return {
          type: 'delay',
          config: {
            days: Number(config.days || 0),
            hours: Number(config.hours || 0)
          }
        };
      case 'if':
        return {
          type: 'if',
          config: {
            conditions: (Array.isArray(config.conditions) ? config.conditions : []).map(c => ({
              field: String(c.field || '').trim(),
              op: String(c.op || 'eq').trim(),
              value: String(c.value !== undefined ? c.value : '').trim()
            })),
            then: (Array.isArray(config.then) ? config.then : []).map(cleanAction),
            ...(Array.isArray(config.else) && config.else.length > 0 ? { else: config.else.map(cleanAction) } : {})
          }
        };
      default:
        return { type, config };
    }
  }

  const pure = {
    cloneRule,
    validateEditorState,
    buildRulePayload,
    TRIGGERS,
    COMMON_FIELDS,
    OPERATORS,
    ACTION_TYPES
  };
  root.PulseRulesEditorPure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------ UI / DOM
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let activeModal = null;

  function openEditor(ruleToEdit) {
    const isEditing = Boolean(ruleToEdit && ruleToEdit.id);
    const formState = ruleToEdit ? {
      name: ruleToEdit.name || '',
      trigger_event: ruleToEdit.trigger || ruleToEdit.trigger_event || 'company.health_changed',
      is_active: ruleToEdit.active !== undefined ? ruleToEdit.active : (ruleToEdit.is_active !== undefined ? ruleToEdit.is_active : true),
      conditions: JSON.parse(JSON.stringify(ruleToEdit.conditions || [])),
      actions: JSON.parse(JSON.stringify(ruleToEdit.actions || []))
    } : {
      name: '',
      trigger_event: 'company.health_changed',
      is_active: true,
      conditions: [],
      actions: [{ type: 'create_task', config: { title: '', severity: 'warn' } }]
    };

    const container = document.getElementById('rules-editor-container') || document.body;
    closeEditor();

    const overlay = el('div', 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto');
    const modal = el('div', 'relative w-full max-w-3xl my-8 bg-white dark:bg-darkbg-850 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 text-slate-800 dark:text-slate-100');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'rules-editor-title');

    // Header
    const header = el('div', 'flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4');
    header.appendChild(el('h2', 'text-xl font-bold text-slate-900 dark:text-white', isEditing ? 'Editar Regra' : 'Nova Regra'));
    const closeBtn = el('button', 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg', '✕');
    closeBtn.setAttribute('aria-label', 'Fechar editor');
    closeBtn.onclick = closeEditor;
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Form body
    const body = el('div', 'space-y-5 max-h-[70vh] overflow-y-auto pr-2');

    // Nome e Ativa
    const row1 = el('div', 'grid grid-cols-1 md:grid-cols-3 gap-4 items-end');
    const nameBox = el('div', 'md:col-span-2 space-y-1');
    nameBox.appendChild(el('label', 'block text-xs font-semibold text-slate-700 dark:text-slate-300', 'Nome da Regra *'));
    const nameInput = el('input', 'w-full px-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-darkbg-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500');
    nameInput.placeholder = 'Ex.: Alerta de queda crítica de saúde';
    nameInput.value = formState.name;
    nameInput.oninput = () => { formState.name = nameInput.value; };
    nameBox.appendChild(nameInput);
    row1.appendChild(nameBox);

    const activeBox = el('div', 'flex items-center gap-2 pb-2.5');
    const activeCb = el('input');
    activeCb.type = 'checkbox';
    activeCb.checked = formState.is_active;
    activeCb.id = 'rule-is-active-cb';
    activeCb.onchange = () => { formState.is_active = activeCb.checked; };
    const activeLbl = el('label', 'text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer', 'Regra Ativa');
    activeLbl.htmlFor = 'rule-is-active-cb';
    activeBox.append(activeCb, activeLbl);
    row1.appendChild(activeBox);
    body.appendChild(row1);

    // Gatilho
    const trigBox = el('div', 'space-y-1');
    trigBox.appendChild(el('label', 'block text-xs font-semibold text-slate-700 dark:text-slate-300', 'Quando este evento acontecer (Gatilho) *'));
    const trigSel = el('select', 'w-full px-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-darkbg-900 border border-slate-200 dark:border-slate-700');
    for (const t of TRIGGERS) {
      const opt = el('option', '', t.label);
      opt.value = t.id;
      if (t.id === formState.trigger_event) opt.selected = true;
      trigSel.appendChild(opt);
    }
    trigSel.onchange = () => { formState.trigger_event = trigSel.value; };
    trigBox.appendChild(trigSel);
    body.appendChild(trigBox);

    // Condições
    const condSection = el('div', 'space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800');
    const condHead = el('div', 'flex items-center justify-between');
    condHead.appendChild(el('h3', 'text-sm font-bold text-slate-900 dark:text-white', 'Se estas condições forem atendidas:'));
    const addCondBtn = el('button', 'text-xs text-brand-600 dark:text-brand-400 hover:underline font-semibold', '+ Adicionar condição');
    addCondBtn.type = 'button';
    condHead.appendChild(addCondBtn);
    condSection.appendChild(condHead);

    const condList = el('div', 'space-y-2');
    function renderConditions() {
      condList.textContent = '';
      if (formState.conditions.length === 0) {
        condList.appendChild(el('p', 'text-xs text-slate-400 italic', 'Sem condições (a regra sempre executará quando o evento ocorrer).'));
      }
      formState.conditions.forEach((c, idx) => {
        const item = el('div', 'flex items-center gap-2 bg-slate-50 dark:bg-darkbg-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800');
        
        // Campo
        const fInput = el('input', 'flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
        fInput.placeholder = 'Campo (ex.: company.health_score)';
        fInput.value = c.field || '';
        fInput.oninput = () => { c.field = fInput.value; };
        
        // Operador
        const opSel = el('select', 'px-2 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
        for (const op of OPERATORS) {
          const o = el('option', '', op.label);
          o.value = op.id;
          if (op.id === c.op) o.selected = true;
          opSel.appendChild(o);
        }
        opSel.onchange = () => { c.op = opSel.value; };

        // Valor
        const vInput = el('input', 'w-32 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
        vInput.placeholder = 'Valor';
        vInput.value = c.value !== undefined ? c.value : '';
        vInput.oninput = () => { c.value = vInput.value; };

        // Remover
        const remBtn = el('button', 'text-rose-500 hover:text-rose-700 p-1 text-xs', 'Remover');
        remBtn.onclick = () => {
          formState.conditions.splice(idx, 1);
          renderConditions();
        };

        item.append(fInput, opSel, vInput, remBtn);
        condList.appendChild(item);
      });
    }
    addCondBtn.onclick = () => {
      formState.conditions.push({ field: 'company.health_score', op: 'lt', value: '50' });
      renderConditions();
    };
    renderConditions();
    condSection.appendChild(condList);
    body.appendChild(condSection);

    // Passos (Ações)
    const actSection = el('div', 'space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800');
    const actHead = el('div', 'flex items-center justify-between');
    actHead.appendChild(el('h3', 'text-sm font-bold text-slate-900 dark:text-white', 'Então execute os seguintes passos: *'));
    const addActBtn = el('button', 'text-xs text-brand-600 dark:text-brand-400 hover:underline font-semibold', '+ Adicionar passo');
    addActBtn.type = 'button';
    actHead.appendChild(addActBtn);
    actSection.appendChild(actHead);

    const actList = el('div', 'space-y-3');
    function renderActions() {
      actList.textContent = '';
      if (formState.actions.length === 0) {
        actList.appendChild(el('p', 'text-xs text-rose-500 italic', 'Adicione pelo menos um passo para a regra.'));
      }
      formState.actions.forEach((act, idx) => {
        const item = el('div', 'bg-slate-50 dark:bg-darkbg-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2');
        const topRow = el('div', 'flex items-center justify-between gap-2');
        topRow.appendChild(el('span', 'text-xs font-semibold text-slate-600 dark:text-slate-400', 'Passo ' + (idx + 1)));

        // Tipo de ação
        const typeSel = el('select', 'px-2 py-1 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
        for (const at of ACTION_TYPES) {
          const o = el('option', '', at.label);
          o.value = at.id;
          if (at.id === act.type) o.selected = true;
          typeSel.appendChild(o);
        }
        typeSel.onchange = () => {
          act.type = typeSel.value;
          act.config = {};
          renderActions();
        };

        const remBtn = el('button', 'text-rose-500 hover:text-rose-700 text-xs font-medium', 'Remover');
        remBtn.onclick = () => {
          formState.actions.splice(idx, 1);
          renderActions();
        };

        topRow.append(typeSel, remBtn);
        item.appendChild(topRow);

        // Campos específicos por tipo
        act.config = act.config || {};
        if (act.type === 'create_task') {
          const tRow = el('div', 'grid grid-cols-1 md:grid-cols-3 gap-2');
          const titleIn = el('input', 'md:col-span-2 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
          titleIn.placeholder = 'Título da tarefa *';
          titleIn.value = act.config.title || '';
          titleIn.oninput = () => { act.config.title = titleIn.value; };

          const sevSel = el('select', 'px-2 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
          for (const s of [{ id: 'critical', l: 'Crítica' }, { id: 'warn', l: 'Atenção' }, { id: 'info', l: 'Informativa' }]) {
            const o = el('option', '', s.l); o.value = s.id;
            if (s.id === (act.config.severity || 'warn')) o.selected = true;
            sevSel.appendChild(o);
          }
          sevSel.onchange = () => { act.config.severity = sevSel.value; };
          tRow.append(titleIn, sevSel);
          item.appendChild(tRow);

          const bodyIn = el('textarea', 'w-full px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
          bodyIn.placeholder = 'Instruções ou corpo opcional da tarefa (suporta {{campo}})';
          bodyIn.rows = 2;
          bodyIn.value = act.config.body || '';
          bodyIn.oninput = () => { act.config.body = bodyIn.value; };
          item.appendChild(bodyIn);
        } else if (act.type === 'add_note') {
          const noteIn = el('textarea', 'w-full px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
          noteIn.placeholder = 'Conteúdo da nota na linha do tempo *';
          noteIn.rows = 2;
          noteIn.value = act.config.content || '';
          noteIn.oninput = () => { act.config.content = noteIn.value; };
          item.appendChild(noteIn);
        } else if (act.type === 'http_request') {
          const hRow = el('div', 'flex items-center gap-2');
          const urlIn = el('input', 'flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
          urlIn.placeholder = 'URL HTTPS (apenas hosts permitidos na allowlist) *';
          urlIn.value = act.config.url || '';
          urlIn.oninput = () => { act.config.url = urlIn.value; };

          const mSel = el('select', 'px-2 py-1.5 rounded-lg text-xs bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
          for (const m of ['POST', 'GET']) {
            const o = el('option', '', m); o.value = m;
            if (m === (act.config.method || 'POST')) o.selected = true;
            mSel.appendChild(o);
          }
          mSel.onchange = () => { act.config.method = mSel.value; };
          hRow.append(urlIn, mSel);
          item.appendChild(hRow);
        } else if (act.type === 'delay') {
          const dRow = el('div', 'flex items-center gap-3 text-xs');
          dRow.appendChild(el('span', 'text-slate-600 dark:text-slate-400', 'Aguardar:'));
          const daysIn = el('input', 'w-20 px-2 py-1 rounded-lg bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
          daysIn.type = 'number'; daysIn.min = '0'; daysIn.max = '90';
          daysIn.value = act.config.days || 0;
          daysIn.oninput = () => { act.config.days = Number(daysIn.value); };
          dRow.append(daysIn, el('span', '', 'dias e'));

          const hoursIn = el('input', 'w-20 px-2 py-1 rounded-lg bg-white dark:bg-darkbg-850 border border-slate-200 dark:border-slate-700');
          hoursIn.type = 'number'; hoursIn.min = '0'; hoursIn.max = '23';
          hoursIn.value = act.config.hours || 0;
          hoursIn.oninput = () => { act.config.hours = Number(hoursIn.value); };
          dRow.append(hoursIn, el('span', '', 'horas'));
          item.appendChild(dRow);
        } else if (act.type === 'if') {
          item.appendChild(el('div', 'text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg', 'Condicional If/Else avançado. Os ramos serão configurados conforme as ações then/else.'));
        }

        actList.appendChild(item);
      });
    }
    addActBtn.onclick = () => {
      formState.actions.push({ type: 'create_task', config: { title: '', severity: 'warn' } });
      renderActions();
    };
    renderActions();
    actSection.appendChild(actList);
    body.appendChild(actSection);

    modal.appendChild(body);

    // Footer com botões de ação
    const footer = el('div', 'flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800');
    const cancelBtn = el('button', 'px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-darkbg-800', 'Cancelar');
    cancelBtn.onclick = closeEditor;

    const saveBtn = el('button', 'px-4 py-2 rounded-xl text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 transition shadow-sm', isEditing ? 'Salvar Alterações' : 'Criar Regra');
    saveBtn.onclick = async () => {
      const val = validateEditorState(formState);
      if (!val.valid) {
        if (root.showToast) root.showToast(val.errors[0], 'warning');
        return;
      }

      const token = root.PulseAuth && root.PulseAuth.token();
      if (!token) {
        if (root.showToast) root.showToast('Faça login como Head para salvar a regra.', 'warning');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando…';

      try {
        const payload = buildRulePayload(formState);
        const url = '/api/automation/rules' + (isEditing ? '?id=' + encodeURIComponent(ruleToEdit.id) : '');
        const res = await fetch(url, {
          method: isEditing ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = data.details ? data.details.join('; ') : (data.error || 'Erro ' + res.status);
          if (root.showToast) root.showToast('Falha ao salvar regra: ' + errMsg, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = isEditing ? 'Salvar Alterações' : 'Criar Regra';
          return;
        }

        if (root.showToast) root.showToast('Regra ' + (isEditing ? 'atualizada' : 'criada') + ' com sucesso!', 'success');
        closeEditor();
        if (root.renderAutomationsTab) root.renderAutomationsTab();
      } catch (err) {
        if (root.showToast) root.showToast('Erro de conexão ao salvar regra.', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isEditing ? 'Salvar Alterações' : 'Criar Regra';
      }
    };

    footer.append(cancelBtn, saveBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    container.appendChild(overlay);
    activeModal = overlay;
  }

  function closeEditor() {
    if (activeModal && activeModal.parentNode) {
      activeModal.parentNode.removeChild(activeModal);
    }
    activeModal = null;
  }

  async function deleteRule(rule) {
    if (!rule || !rule.id) return;
    if (!confirm('Deseja realmente excluir a regra "' + rule.name + '"? Esta ação não pode ser desfeita.')) {
      return;
    }

    const token = root.PulseAuth && root.PulseAuth.token();
    if (!token) {
      if (root.showToast) root.showToast('Faça login como Head para excluir regras.', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/automation/rules?id=' + encodeURIComponent(rule.id), {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (root.showToast) root.showToast('Falha ao excluir: ' + (data.error || res.status), 'error');
        return;
      }
      if (root.showToast) root.showToast('Regra "' + rule.name + '" excluída.', 'success');
      if (root.renderAutomationsTab) root.renderAutomationsTab();
    } catch {
      if (root.showToast) root.showToast('Erro de conexão ao excluir regra.', 'error');
    }
  }

  root.PulseRulesEditor = {
    open: openEditor,
    close: closeEditor,
    clone: r => openEditor(cloneRule(r)),
    delete: deleteRule
  };
})(typeof window !== 'undefined' ? window : globalThis);
