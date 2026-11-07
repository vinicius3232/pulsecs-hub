/* PulseCS — camada de dados (P1)
 *
 * Modo "demo": nada muda (localStorage, dados fictícios).
 * Modo "db": a carteira, a equipe e as reuniões vêm do Supabase e as edições são gravadas lá.
 *
 * As telas usam ids numéricos dentro de onclick="...(${c.id})". Para não reescrevê-las, cada linha do
 * banco ganha um id numérico ESTÁVEL derivado do uuid (e o uuid fica em c.uuid, que é o que vai ao banco).
 * Quem decide o que cada perfil pode gravar é a RLS (migration 0004); aqui só se trata o erro.
 */
(function (root) {
  'use strict';

  const PHASES = ['Kickoff', 'Config & Carga', 'Treinamento', 'Go-Live'];
  const TIERS = ['SMB', 'Mid-Market', 'Enterprise'];
  const MEETING_TYPES = ['Kickoff', 'Treinamento', 'Alinhamento', 'QBR', 'Risco'];
  const COLORS = ['indigo', 'purple', 'emerald', 'rose', 'amber', 'blue'];
  const ROLE_LABEL = { head: 'Head de CS', csm: 'CSM', is: 'Implementation Specialist (IS)', viewer: 'Leitura' };
  const NO_EMAIL = 'sem-email@pulsecs.invalid'; // contacts.email é NOT NULL; .invalid é TLD reservado

  // ---------------------------------------------------------------- ids estáveis
  const idByUuid = new Map();
  const uuidById = new Map();
  function numId(uuid) {
    if (!uuid) return null;
    if (idByUuid.has(uuid)) return idByUuid.get(uuid);
    let n = parseInt(String(uuid).replace(/-/g, '').slice(0, 8), 16) || 1;
    while (uuidById.has(n) && uuidById.get(n) !== uuid) n++;
    idByUuid.set(uuid, n);
    uuidById.set(n, uuid);
    return n;
  }
  const uuidFor = n => uuidById.get(Number(n)) || null;

  // ---------------------------------------------------------------- formatação
  const pad = n => String(n).padStart(2, '0');

  /** "Hoje, 11:40" / "Ontem, 16:30" / "Há 12 dias" a partir do timestamp do banco. */
  function fmtLogin(iso, now) {
    if (!iso) return 'Sem registro';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Sem registro';
    now = now || new Date();
    const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(now) - startOf(d)) / 86400000);
    const hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (days <= 0) return 'Hoje, ' + hhmm;
    if (days === 1) return 'Ontem, ' + hhmm;
    return 'Há ' + days + ' dias';
  }

  function contactString(c) {
    if (!c) return 'Sem contato';
    return c.role ? c.name + ' (' + c.role + ')' : c.name;
  }

  /** "Nome (Papel)" -> { name, role }. Sem parênteses, o papel padrão do banco. */
  function parseContact(str) {
    const s = String(str || '').trim();
    const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const name = (m ? m[1] : s).trim().slice(0, 120);
    const role = (m ? m[2] : '').trim().slice(0, 60) || 'Gestor de RH';
    return { name, role };
  }

  function daysUntil(dateStr, now) {
    if (!dateStr) return null;
    const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
    if (!y) return null;
    now = now || new Date();
    const a = Date.UTC(y, m - 1, d);
    const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((a - b) / 86400000);
  }

  const renewalStage = days => (days === null ? '90d' : days <= 30 ? '30d' : days <= 60 ? '60d' : '90d');

  // ---------------------------------------------------------------- mapeamentos linha -> modelo da tela
  function mapCsm(row) {
    const name = row.name || 'Sem nome';
    return {
      id: numId(row.id),
      uuid: row.id,
      name,
      role: ROLE_LABEL[row.role] || row.role,
      dbRole: row.role,
      avatar: (row.avatar_initials || name.split(/\s+/).map(w => w[0]).slice(0, 2).join('')).toUpperCase().slice(0, 3),
      color: COLORS.includes(row.color) ? row.color : 'indigo',
      maxAccounts: Number(row.max_accounts) || 6,
      status: row.status || 'Disponível'
    };
  }

  function mapCompany(row, contact, now) {
    const days = daysUntil(row.renewal_date, now);
    return {
      id: numId(row.id),
      uuid: row.id,
      name: row.name,
      tier: TIERS.includes(row.tier) ? row.tier : 'Mid-Market',
      mrr: Number(row.mrr) || 0,
      hs: Number(row.health_score) || 0,
      status: ['green', 'yellow', 'red'].includes(row.health_status) ? row.health_status : 'yellow',
      lastLogin: fmtLogin(row.last_login_at, now),
      loginDays: loginDaysOf(row.last_login_at, now),
      contact: contactString(contact),
      phase: PHASES.includes(row.phase) ? row.phase : 'Kickoff',
      riskReason: row.risk_reason || 'Nenhum',
      csmId: numId(row.csm_id),
      phone: (contact && contact.phone) || '',
      email: (contact && contact.email && contact.email !== NO_EMAIL) ? contact.email : '',
      // adoção e renovação (usadas pelo Raio-X e pelo pipeline de renovação)
      eligibleLives: Number(row.eligible_lives) || 0,
      activeLives: Number(row.active_lives) || 0,
      mauLives: Number(row.mau_lives) || 0,
      totalSavings: Number(row.total_savings) || 0,
      pepm: Number(row.pepm) || 0,
      npsScore: row.nps_score === null || row.nps_score === undefined ? null : Number(row.nps_score),
      overdue: !!row.has_overdue_invoice,
      riskFactors: Array.isArray(row.risk_factors) ? row.risk_factors.map(String).slice(0, 10) : [],
      healthComputed: !!row.health_computed_at,
      renewalDate: row.renewal_date || null,
      daysToRenewal: days,
      renewalStage: renewalStage(days),
      _contactId: contact ? contact.id : null
    };
  }

  function mapMeeting(row, company, contact) {
    const d = new Date(row.scheduled_at);
    return {
      id: numId(row.id),
      uuid: row.id,
      date: row.scheduled_at,
      day: d.getDate(),
      time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
      company: company ? company.name : 'Empresa removida',
      companyUuid: row.company_id,
      subject: row.subject,
      type: MEETING_TYPES.includes(row.meeting_type) ? row.meeting_type : 'Alinhamento',
      status: company ? company.status : 'yellow',
      hs: company ? company.hs : 0,
      briefing: row.ai_briefing || row.notes || 'Sem briefing registrado.',
      contact: contactString(contact),
      meetUrl: row.meet_url || 'https://meet.google.com/new',
      completed: !!row.completed
    };
  }

  // ---------------------------------------------------------------- modelo da tela -> linha
  /** O que identifica "mudou" para fins de sincronização (saúde é do servidor: não entra). */
  const clientKey = c => JSON.stringify([c.name, c.tier, c.mrr, c.phase, c.riskReason, c.csmId, c.contact]);

  function companyPayload(c, defaultCsmUuid) {
    return {
      name: String(c.name || '').trim().slice(0, 160),
      tier: TIERS.includes(c.tier) ? c.tier : 'Mid-Market',
      mrr: Math.max(0, Number(c.mrr) || 0),
      phase: PHASES.includes(c.phase) ? c.phase : 'Kickoff',
      risk_reason: c.riskReason && c.riskReason !== 'Nenhum' ? String(c.riskReason).slice(0, 300) : 'Nenhum',
      csm_id: (c.csmId && uuidFor(c.csmId)) || defaultCsmUuid || null
    };
  }

  function contactPayload(c) {
    const { name, role } = parseContact(c.contact);
    return {
      name: name || 'Contato',
      role,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email || '') ? c.email : NO_EMAIL,
      phone: String(c.phone || '').replace(/\D/g, '').slice(0, 20) || null
    };
  }

  function toIsoLocal(dateIso, time) {
    // Data (do dia) + "HH:MM" locais -> ISO UTC para timestamptz
    const base = dateIso ? new Date(dateIso) : new Date();
    const [h, m] = String(time || '09:00').split(':').map(Number);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h || 0, m || 0).toISOString();
  }

  function meetingPayload(e, companyUuid) {
    return {
      company_id: companyUuid,
      scheduled_at: e.date ? new Date(e.date).toISOString() : toIsoLocal(null, e.time),
      meeting_type: MEETING_TYPES.includes(e.type) ? e.type : 'Alinhamento',
      subject: String(e.subject || 'Reunião').slice(0, 200),
      ai_briefing: e.briefing ? String(e.briefing).slice(0, 2000) : null,
      meet_url: e.meetUrl || null
    };
  }

  // ---------------------------------------------------------------- calendário
  const DEMO_TODAY = { y: 2026, m: 10, d: 6 };
  function eventOnDay(e, day, month, year) {
    if (e.date) {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    }
    return e.day === day && month === 10 && year === 2026; // eventos de demonstração
  }

  /** Indicadores que o banco consegue calcular HOJE. O resto (NRR, variação de MRR, taxa de resposta) exige histórico que ainda não existe. */
  function derivedKpis(clients) {
    const withMetrics = clients.filter(c => c.eligibleLives > 0);
    const elig = withMetrics.reduce((a, c) => a + c.eligibleLives, 0);
    const act = withMetrics.reduce((a, c) => a + c.activeLives, 0);
    const savings = clients.reduce((a, c) => a + (c.totalSavings || 0), 0);
    const renewMrr = clients.filter(c => c.daysToRenewal !== null && c.daysToRenewal !== undefined && c.daysToRenewal <= 90)
      .reduce((a, c) => a + c.mrr, 0);
    return {
      adoption: elig > 0 ? (act / elig * 100).toFixed(1) + '%' : '—',
      savings: savings > 0 ? 'R$ ' + (savings / 1000).toFixed(1) + 'k' : '—',
      renewalMrr: 'R$ ' + (renewMrr / 1000).toFixed(1) + 'k'
    };
  }

  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  /** Média do score por mês (todas as empresas) a partir dos snapshots diários, últimos 6 meses com dados. */
  function monthlyTrend(snaps) {
    const by = new Map();
    for (const s of snaps) {
      const key = String(s.recorded_at).slice(0, 7); // AAAA-MM
      const cur = by.get(key) || { sum: 0, n: 0 };
      cur.sum += Number(s.health_score) || 0; cur.n++;
      by.set(key, cur);
    }
    const keys = Array.from(by.keys()).sort().slice(-6);
    return keys.map(k => ({ label: MONTHS[Number(k.slice(5, 7)) - 1] + '/' + k.slice(2, 4), avg: Math.round(by.get(k).sum / by.get(k).n) }));
  }

  function mapTask(r) {
    return {
      id: r.id,
      companyUuid: r.company_id || null,
      title: String(r.title || '').slice(0, 300),
      body: r.body ? String(r.body).slice(0, 1000) : '',
      severity: ['critical', 'warn', 'info'].includes(r.severity) ? r.severity : 'info',
      createdAt: r.created_at
    };
  }

  const CHANNEL_LABEL = { whatsapp: 'WhatsApp', email: 'E-mail', salez_agent: 'Agente Salez', call: 'Ligação', note: 'Nota' };
  const TRIGGER_LABEL = { automation: 'Automação', manual_contact: 'Contato manual', churn_rescue: 'Resgate de conta', onboarding_unlock: 'Destravar onboarding', qbr_invite: 'Convite de QBR' };

  function mapInteraction(r) {
    return {
      id: r.id,
      channel: CHANNEL_LABEL[r.channel] || String(r.channel || 'Contato'),
      trigger: TRIGGER_LABEL[r.trigger_type] || String(r.trigger_type || ''),
      content: String(r.content || '').slice(0, 400),
      when: r.sent_at || null
    };
  }

  // ---------------------------------------------------------------- sinais da carteira (tela inicial)
  const CONTACT_CHANNELS = ['whatsapp', 'email', 'call', 'salez_agent']; // nota/automação não conta como contato com o cliente
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

  /** Dias desde o último login do admin (null = nunca logou). */
  function loginDaysOf(iso, now) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return Math.max(0, Math.round((startOfDay(now || new Date()) - startOfDay(d)) / 86400000));
  }

  /** interactions (company_id, channel, sent_at) -> Map(company_id -> { at, days }) só com contatos reais. */
  function latestContacts(rows, now) {
    now = now || new Date();
    const out = new Map();
    for (const r of rows || []) {
      if (!r || !r.company_id || CONTACT_CHANNELS.indexOf(r.channel) === -1) continue;
      const t = new Date(r.sent_at).getTime();
      if (Number.isNaN(t)) continue;
      const cur = out.get(r.company_id);
      if (!cur || t > new Date(cur.at).getTime()) {
        out.set(r.company_id, { at: new Date(t).toISOString(), days: Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(t))) / 86400000)) });
      }
    }
    return out;
  }

  /** health_snapshots (company_id, activation_rate, recorded_at) -> Map(company_id -> % de variação da ativação, ou null). */
  function growthByCompany(rows) {
    const by = new Map();
    for (const r of rows || []) {
      if (!r || !r.company_id) continue;
      const v = Number(r.activation_rate);
      if (!Number.isFinite(v)) continue;
      if (!by.has(r.company_id)) by.set(r.company_id, []);
      by.get(r.company_id).push({ t: String(r.recorded_at), v });
    }
    const out = new Map();
    for (const [id, list] of by) {
      list.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
      const first = list[0].v, last = list[list.length - 1].v;
      out.set(id, list.length >= 2 && first > 0 ? Math.round(((last - first) / first) * 100) : null);
    }
    return out;
  }

  /** Grava nos clientes da tela: último contato, contato no mês corrente e crescimento. */
  function applyHomeSignals(list, contacts, growth, now) {
    now = now || new Date();
    for (const c of list) {
      const k = contacts && contacts.get(c.uuid);
      c.lastContactAt = k ? k.at : null;
      c.lastContactDays = k ? k.days : null;
      const d = k ? new Date(k.at) : null;
      c.contactedThisMonth = !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      c.growthPct = growth && growth.has(c.uuid) ? growth.get(c.uuid) : null;
    }
  }

  const pure = {
    CONTACT_CHANNELS, loginDaysOf, latestContacts, growthByCompany, applyHomeSignals,
    mapInteraction,
    mapTask, derivedKpis, monthlyTrend,
    numId, uuidFor, fmtLogin, contactString, parseContact, daysUntil, renewalStage,
    mapCsm, mapCompany, mapMeeting, clientKey, companyPayload, contactPayload, meetingPayload,
    toIsoLocal, eventOnDay, NO_EMAIL,
    _reset() { idByUuid.clear(); uuidById.clear(); }
  };

  // ---------------------------------------------------------------- parte "viva" (navegador)
  const PulseData = {
    mode: 'demo',
    status: 'idle',           // idle | loading | ready | saving | error
    lastSync: null,
    error: null,
    me: null,                 // { uuid, role, name }
    eventOnDay,
    isToday(day, month, year) {
      if (PulseData.mode !== 'db') return day === DEMO_TODAY.d && month === DEMO_TODAY.m && year === DEMO_TODAY.y;
      const n = new Date();
      return day === n.getDate() && month === n.getMonth() && year === n.getFullYear();
    }
  };

  if (typeof document !== 'undefined') {
    let sb = null;
    let snapshot = new Map();      // uuid -> clientKey persistido
    let chain = Promise.resolve();
    let timer = null;

    const hhmm = () => { const n = new Date(); return pad(n.getHours()) + ':' + pad(n.getMinutes()); };

    function banner(text, tone) {
      if (root.PulseAuth && root.PulseAuth.banner) root.PulseAuth.banner(text, tone);
    }

    function setStatus(status, text, tone) {
      PulseData.status = status;
      banner(text, tone || (status === 'error' ? 'error' : 'info'));
    }

    function rerender() {
      try {
        if (root.populateOwnerFilter) root.populateOwnerFilter();
        root.refreshAllViews();
        const active = document.querySelector('.tab-content:not(.hidden)');
        if (active) root.switchTab(active.id.replace('tab-', ''));
      } catch (e) { /* tela ainda montando */ }
    }

    async function fetchAll() {
      const [csm, comp, cont, meet, task] = await Promise.all([
        sb.from('csm_users').select('*').eq('is_active', true).order('created_at'),
        sb.from('companies').select('*').order('created_at', { ascending: false }),
        sb.from('contacts').select('*').order('created_at'),
        sb.from('meetings').select('*').order('scheduled_at'),
        sb.from('csm_tasks').select('*').eq('status', 'open').order('created_at')
      ]);
      for (const [name, r] of [['equipe', csm], ['empresas', comp], ['contatos', cont], ['reuniões', meet], ['tarefas', task]]) {
        if (r.error) throw new Error(name + ': ' + r.error.message);
      }
      const since = n => new Date(Date.now() - n * 86400000).toISOString();
      const optional = async fn => { try { const r = await fn(); return r && !r.error ? (r.data || []) : []; } catch (e) { return []; } };
      const [inter, snaps] = await Promise.all([
        optional(() => sb.from('interactions').select('company_id,channel,sent_at').gte('sent_at', since(70)).order('sent_at', { ascending: false }).limit(5000)),
        optional(() => sb.from('health_snapshots').select('company_id,activation_rate,recorded_at').gte('recorded_at', since(45).slice(0, 10)).order('recorded_at', { ascending: true }).limit(5000))
      ]);
      return { csm: csm.data || [], comp: comp.data || [], cont: cont.data || [], meet: meet.data || [], task: task.data || [], inter, snaps };
    }

    function applyData(d) {
      const now = new Date();
      // contato principal = decisor, senão o mais antigo
      const primary = new Map();
      for (const c of d.cont) {
        const cur = primary.get(c.company_id);
        if (!cur || (c.is_decision_maker && !cur.is_decision_maker)) primary.set(c.company_id, c);
      }
      const team = d.csm.map(mapCsm);
      const hasNonViewer = team.some(t => t.dbRole !== 'viewer');
      teamCSMs = hasNonViewer ? team.filter(t => t.dbRole !== 'viewer') : team;

      const mapped = d.comp.map(r => mapCompany(r, primary.get(r.id), now));
      clients = mapped;
      applyHomeSignals(mapped, latestContacts(d.inter, now), growthByCompany(d.snaps), now);
      const byUuid = new Map(mapped.map(c => [c.uuid, c]));
      calendarEvents = d.meet.map(r => mapMeeting(r, byUuid.get(r.company_id), primary.get(r.company_id)));

      PulseData.tasks = (d.task || []).map(mapTask);
      snapshot = new Map(mapped.map(c => [c.uuid, clientKey(c)]));
      currentCalendarMonth = now.getMonth();
      currentCalendarYear = now.getFullYear();
    }

    // Números fixos do HTML: calcula o que dá, neutraliza o que exigiria histórico que ainda não existe
    PulseData.applyDerivedKpis = function () {
      if (PulseData.mode !== 'db') return;
      const k = derivedKpis(clients);
      const set = (key, text, title) => document.querySelectorAll('[data-demo="' + key + '"]').forEach(el => {
        el.textContent = text; if (title) el.title = title;
      });
      const needsHistory = 'Requer histórico de receita (ainda não há)';
      set('nrr', '—', needsHistory);
      set('nrr-note', 'sem histórico de receita', needsHistory);
      set('mrr-delta', 'sem histórico de receita', needsHistory);
      set('resp-rate', '—', 'Requer registro de respostas dos clientes (ainda não há)');
      set('adoption', k.adoption, 'Ativadas ÷ elegíveis, só empresas com métricas');
      set('savings', k.savings, 'Soma da economia gerada informada pela plataforma');
      set('renewal-mrr', k.renewalMrr, 'MRR das contas que renovam em até 90 dias');
    };

    // Tendência do Health Score a partir dos snapshots diários do servidor
    PulseData.loadTrend = async function () {
      const badge = document.querySelector('[data-demo="trend"]');
      try {
        const { data, error } = await sb.from('health_snapshots').select('recorded_at, health_score').order('recorded_at');
        if (error) throw new Error(error.message);
        const pts = monthlyTrend(data || []);
        if (typeof chartHsInstance !== 'undefined' && chartHsInstance) {
          chartHsInstance.data.labels = pts.map(p => p.label);
          chartHsInstance.data.datasets[0].data = pts.map(p => p.avg);
          chartHsInstance.data.datasets[1].data = pts.map(() => 80);
          chartHsInstance.update();
        }
        if (badge) {
          if (pts.length >= 2) {
            const diff = pts[pts.length - 1].avg - pts[0].avg;
            badge.textContent = (diff >= 0 ? 'Tendência de alta (+' : 'Tendência de queda (') + diff + ' pts)';
          } else {
            badge.textContent = 'Sem histórico ainda: o primeiro snapshot é gravado no cálculo diário';
          }
        }
      } catch (e) {
        if (badge) badge.textContent = 'Histórico indisponível';
      }
    };

    // Raio-X: adoção e fatores de risco calculados pelo servidor (nada de texto genérico)
    PulseData.fillClientModal = function (c) {
      const box = document.getElementById('modal-client-adoption');
      if (!box) return;
      if (PulseData.mode !== 'db') { box.classList.add('hidden'); const tl = document.getElementById('modal-client-timeline'); if (tl) tl.classList.add('hidden'); return; }
      PulseData.loadTimeline(c);
      const insight = document.getElementById('modal-client-copilot-insight');
      const grid = document.getElementById('modal-client-adoption-grid');
      const list = document.getElementById('modal-client-factors');
      const pct = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—');
      const tiles = [
        ['Elegíveis', c.eligibleLives || '—'],
        ['Ativadas', c.eligibleLives ? c.activeLives + ' (' + pct(c.activeLives, c.eligibleLives) + ')' : '—'],
        ['MAU', c.activeLives ? c.mauLives + ' (' + pct(c.mauLives, c.activeLives) + ' das ativadas)' : '—'],
        ['Economia gerada', c.totalSavings ? 'R$ ' + c.totalSavings.toLocaleString('pt-BR') : '—'],
        ['NPS', c.npsScore === null ? 'sem NPS' : c.npsScore],
        ['Renovação', c.renewalDate ? c.renewalDate + (c.daysToRenewal !== null ? ' (' + c.daysToRenewal + ' dias)' : '') : '—'],
        ['Inadimplência', c.overdue ? 'Fatura em atraso' : 'Em dia']
      ];
      grid.textContent = '';
      for (const [k, v] of tiles) {
        const t = document.createElement('div');
        t.className = 'p-2 rounded-lg bg-slate-50 dark:bg-darkbg-900 border border-slate-200 dark:border-slate-800';
        const a = document.createElement('div'); a.className = 'text-slate-500 dark:text-slate-400'; a.textContent = k;
        const b = document.createElement('div'); b.className = 'font-semibold text-slate-900 dark:text-white'; b.textContent = String(v);
        t.append(a, b); grid.appendChild(t);
      }
      list.textContent = '';
      for (const f of c.riskFactors) { const li = document.createElement('li'); li.textContent = f; list.appendChild(li); }
      if (insight) {
        insight.textContent = !c.healthComputed
          ? 'Sem métricas de adoção ainda: o score só é calculado quando a plataforma enviar vidas elegíveis, ativadas e MAU.'
          : c.riskFactors.length
            ? 'Fatores de risco detectados no último cálculo (' + c.hs + '/100):'
            : 'Nenhum fator de risco no último cálculo (' + c.hs + '/100).';
      }
      box.classList.remove('hidden');
    };

    // Linha do tempo de contatos da empresa (últimos 15). Ignora a resposta se o modal já mudou de empresa.
    PulseData.loadTimeline = async function (c) {
      const box = document.getElementById('modal-client-timeline');
      const list = document.getElementById('modal-client-timeline-list');
      if (!box || !list) return;
      if (PulseData.mode !== 'db' || !c.uuid) { box.classList.add('hidden'); return; }
      list.textContent = '';
      const loading = document.createElement('li'); loading.className = 'text-slate-500 dark:text-slate-400'; loading.textContent = 'Carregando…';
      list.appendChild(loading); box.classList.remove('hidden');
      try {
        const { data, error } = await sb.from('interactions').select('*').eq('company_id', c.uuid).order('sent_at', { ascending: false }).limit(15);
        if (error) throw new Error(error.message);
        if (typeof activeClientForModal === 'undefined' || !activeClientForModal || activeClientForModal.uuid !== c.uuid) return;
        list.textContent = '';
        const rows = (data || []).map(mapInteraction);
        if (!rows.length) {
          const li = document.createElement('li'); li.className = 'text-slate-500 dark:text-slate-400'; li.textContent = 'Nenhum contato registrado ainda.'; list.appendChild(li); return;
        }
        for (const r of rows) {
          const li = document.createElement('li');
          li.className = 'p-2 rounded-lg bg-slate-50 dark:bg-darkbg-900 border border-slate-200 dark:border-slate-800';
          const top = document.createElement('div'); top.className = 'flex justify-between gap-2 text-slate-500 dark:text-slate-400';
          const who = document.createElement('span'); who.textContent = r.channel + (r.trigger ? ' · ' + r.trigger : '');
          const at = document.createElement('span');
          at.textContent = r.when ? new Date(r.when).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
          top.append(who, at);
          const body = document.createElement('div'); body.className = 'text-slate-900 dark:text-slate-100'; body.textContent = r.content;
          li.append(top, body); list.appendChild(li);
        }
      } catch (e) {
        list.textContent = '';
        const li = document.createElement('li'); li.className = 'text-rose-700 dark:text-rose-400'; li.textContent = 'Não foi possível carregar o histórico.'; list.appendChild(li);
      }
    };

    PulseData.load = async function () {
      setStatus('loading', 'Carregando carteira do banco…', 'info');
      PulseData.error = null;
      try {
        applyData(await fetchAll());
        PulseData.lastSync = new Date();
        setStatus('ready', 'Conectado ao banco · ' + clients.length + ' empresas · atualizado às ' + hhmm(), 'info');
      } catch (err) {
        PulseData.error = err.message;
        setStatus('error', 'Não foi possível carregar a carteira do banco (' + err.message + '). Os dados mostrados podem estar incompletos.', 'error');
      }
      rerender();
      PulseData.applyDerivedKpis();
      if (!PulseData.error) PulseData.loadTrend();
    };

    PulseData.start = async function (client, profile) {
      sb = client;
      PulseData.mode = 'db';
      PulseData.me = { uuid: profile.id, role: profile.role, name: profile.name };
      document.body.setAttribute('data-mode', 'db');
      // nada de dados de demonstração na tela enquanto o banco responde
      clients = []; teamCSMs = []; calendarEvents = [];
      PulseData.noteDemoTabs();
      await PulseData.load();
    };

    // Abas com conteúdo fixo (não vem do banco) ganham um aviso explícito
    PulseData.noteDemoTabs = function () {
      for (const id of ['reports', 'campaigns', 'partners', 'reminders']) {
        const sec = document.getElementById('tab-' + id);
        if (!sec || sec.querySelector('[data-demo-note]')) continue;
        const n = document.createElement('div');
        n.setAttribute('data-demo-note', '');
        n.className = 'px-3 py-2 rounded-lg text-xs border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300';
        n.textContent = 'Conteúdo de demonstração: esta tela ainda não usa os dados do banco.';
        sec.insertBefore(n, sec.firstChild);
      }
    };

    // ---------------- gravação (diferença entre a tela e o último estado salvo)
    async function syncCompanies(errors) {
      const seen = new Set();
      for (const c of clients.slice()) {
        try {
          if (!c.uuid) {
            const payload = companyPayload(c, PulseData.me.uuid);
            const { data, error } = await sb.from('companies').insert(payload).select().single();
            if (error) throw new Error(error.message);
            c.uuid = data.id; c.id = numId(data.id);
            c.hs = Number(data.health_score) || c.hs; c.status = data.health_status || c.status; // a saude e do servidor
            if (!c.csmId && data.csm_id) c.csmId = numId(data.csm_id);
            if (c.contact && c.contact !== 'Sem contato') {
              const { data: ct, error: ce } = await sb.from('contacts').insert({ company_id: data.id, is_decision_maker: true, ...contactPayload(c) }).select().single();
              if (!ce && ct) c._contactId = ct.id;
            }
            seen.add(c.uuid); snapshot.set(c.uuid, clientKey(c));
            continue;
          }
          seen.add(c.uuid);
          const key = clientKey(c);
          const before = snapshot.get(c.uuid);
          if (before === key) continue;

          const prev = before ? JSON.parse(before) : [];
          const { data: upd, error } = await sb.from('companies')
            .update({ ...companyPayload(c, null), updated_at: new Date().toISOString() })
            .eq('id', c.uuid)
            .select('id');
          if (error) throw new Error(error.message);
          // A RLS bloqueia UPDATE sem devolver erro: 0 linhas afetadas = sem permissão (ou removida)
          if (!upd || upd.length === 0) throw new Error('sem permissão para alterar esta empresa (ou ela foi removida)');

          if (prev[6] !== c.contact) { // contato principal mudou
            if (c._contactId) {
              const { name, role } = parseContact(c.contact);
              const { data: uc, error: ue } = await sb.from('contacts').update({ name, role }).eq('id', c._contactId).select('id');
              if (ue) throw new Error(ue.message);
              if (!uc || uc.length === 0) throw new Error('sem permissão para alterar o contato');
            } else if (c.contact && c.contact !== 'Sem contato') {
              const { data: ct, error: ie } = await sb.from('contacts').insert({ company_id: c.uuid, is_decision_maker: true, ...contactPayload(c) }).select().single();
              if (ie) throw new Error(ie.message);
              c._contactId = ct.id;
            }
          }
          snapshot.set(c.uuid, key);
        } catch (e) {
          errors.push((c.name || 'empresa') + ': ' + e.message);
        }
      }
      for (const uuid of Array.from(snapshot.keys())) {
        if (seen.has(uuid)) continue;
        const { data: del, error } = await sb.from('companies').delete().eq('id', uuid).select('id');
        if (error) errors.push('exclusão: ' + error.message);
        else if (!del || del.length === 0) errors.push('exclusão: sem permissão para excluir esta empresa');
        else snapshot.delete(uuid);
      }
    }

    async function syncMeetings(errors) {
      for (const e of calendarEvents.slice()) {
        if (e.uuid) continue;
        try {
          const company = clients.find(c => c.uuid && (c.uuid === e.companyUuid || c.name === e.company));
          if (!company) throw new Error('empresa da reunião ainda não existe no banco');
          const { data, error } = await sb.from('meetings').insert(meetingPayload(e, company.uuid)).select().single();
          if (error) throw new Error(error.message);
          e.uuid = data.id; e.id = numId(data.id); e.companyUuid = company.uuid; e.date = data.scheduled_at;
        } catch (err) {
          errors.push('reunião "' + (e.subject || '') + '": ' + err.message);
        }
      }
    }

    async function runSync() {
      const errors = [];
      await syncCompanies(errors);
      await syncMeetings(errors);
      if (errors.length) {
        setStatus('error', 'Não foi possível salvar: ' + errors[0] + '. Recarregando o estado do banco.', 'error');
        if (root.showToast) root.showToast('Alteração não permitida ou falhou: ' + errors[0], 'error');
        await PulseData.load(); // descarta o que o banco recusou
      } else {
        PulseData.lastSync = new Date();
        setStatus('ready', 'Conectado ao banco · ' + clients.length + ' empresas · salvo às ' + hhmm(), 'info');
      }
    }

    PulseData.scheduleSync = function () {
      if (PulseData.mode !== 'db') return;
      clearTimeout(timer);
      setStatus('saving', 'Salvando no banco…', 'info');
      timer = setTimeout(() => { chain = chain.then(runSync).catch(() => {}); }, 250);
    };
    PulseData.flush = function () { clearTimeout(timer); chain = chain.then(runSync).catch(() => {}); return chain; };

    // Conclui uma tarefa. A RLS só deixa o dono (ou o Head); 0 linhas afetadas = sem permissão.
    PulseData.completeTask = async function (taskId) {
      try {
        const { data, error } = await sb.from('csm_tasks')
          .update({ status: 'done', done_at: new Date().toISOString() })
          .eq('id', taskId)
          .select('id');
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) throw new Error('sem permissão para concluir esta tarefa');
        PulseData.tasks = (PulseData.tasks || []).filter(t => t.id !== taskId);
        if (root.showToast) root.showToast('Tarefa concluída.', 'success');
      } catch (e) {
        if (root.showToast) root.showToast('Não foi possível concluir: ' + e.message, 'error');
      }
      if (root.renderTodayTab) root.renderTodayTab();
    };

    PulseData.tasks = [];

    PulseData.logInteraction = async function (client, channel, trigger, content) {
      if (PulseData.mode !== 'db' || !client || !client.uuid) return;
      const { error } = await sb.from('interactions').insert({
        company_id: client.uuid,
        csm_id: PulseData.me.uuid,
        channel, trigger_type: trigger, content: String(content).slice(0, 2000), status: 'sent'
      });
      if (error && root.showToast) root.showToast('Não foi possível registrar o contato: ' + error.message, 'error');
      if (!error && CONTACT_CHANNELS.indexOf(channel) !== -1) {
        client.lastContactAt = new Date().toISOString(); client.lastContactDays = 0; client.contactedThisMonth = true;
        if (root.renderTodayTab) root.renderTodayTab();
      }
    };
  }

  root.PulseData = PulseData;
  root.PulseDataPure = pure;
  if (typeof module !== 'undefined' && module.exports) module.exports = { pure, PulseData };
})(typeof window !== 'undefined' ? window : globalThis);
