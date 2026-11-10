// Páginas do CRM.
import { h, clear, api, save, del, state, loadMeta, opts, money, num, date, dateTime, today, fmtField, csvLinhas, relativo, statusBadge, docStatus, toast, guard, modal,
  confirmDialog, promptDialog, menu, sel, field, form, rowsOf, invalidate, dataList, filterBuilder, initials, compact, download, lookup, moneyShort } from './ui.js';
import { ENTITIES, AGGREGATORS, RELATIVE_DATES, PALETTE, NUMERIC } from './schema.js';
import { chipOrigem, PLAT } from './whatsapp.js';

const page = (content, title, actions = [], sub) => {
  const p = h('div.page', h('div.pagehead', h('h1', title), ...actions), sub || null);
  content.append(p); return p;
};
const refresh = (...ents) => { invalidate(...ents); window.dispatchEvent(new Event('lente:refresh')); };
const go = hash => { location.hash = hash; };
const ehAdmin = () => state.me?.role === 'Administrador';
// Botão "⋯" de ações secundárias (some se não houver item visível para o perfil)
const maisAcoes = (itens, rotulo = 'Mais ações') => { const v = itens.filter(Boolean); return v.length ? h('button.iconbtn', { title: rotulo, 'aria-label': rotulo, on: { click: e => menu(e.currentTarget, v) } }, 'ph:dots-three') : null; };
// Controle segmentado para filtros (botões com aria-pressed)
const segmento = (rotulo, opcoes, atual, aoMudar) => h('div.seg', { role: 'group', 'aria-label': rotulo },
  opcoes.map(([k, l]) => h(`button${k === atual ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(k === atual), on: { click: () => aoMudar(k) } }, l)));

// =================== RESUMO ===================
export async function homePage(content) {
  const d = await api('/dashboard'); const k = d.kpi;
  const hoje = new Date(), mes = hoje.toLocaleDateString('pt-BR', { month: 'long' });
  const titulo = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, c => c.toUpperCase());
  const atrasadas = d.tasksToday.filter(t => t.date < today()).length;
  const resumo = !d.tasksToday.length ? 'Nenhuma tarefa para hoje. Bom dia para prospectar.'
    : `${d.tasksToday.length} ${d.tasksToday.length === 1 ? 'tarefa' : 'tarefas'} para hoje${atrasadas ? `, ${atrasadas} ${atrasadas === 1 ? 'atrasada' : 'atrasadas'}` : ''}.`;
  const p = page(content, titulo, [h('a.btn', { href: '#/tarefas' }, 'ph:calendar-check Ver agenda')], h('div.subtabs', h('a.on', { href: '#/' }, 'Resumo'), h('a', { href: '#/metas' }, 'Metas')));
  p.querySelector('.pagehead h1').after(h('p.lede', resumo));
  p.append(h('div.kpis', { role: 'list' },
    [['Em andamento', num(k.dealsOpen.n), moneyShort(k.dealsOpen.s)], [`Novos em ${mes}`, num(k.dealsMonth.n), 'negócios criados'],
      [`Ganhos em ${mes}`, num(k.wonMonth.n), moneyShort(k.wonMonth.s)], [`Propostas em ${mes}`, num(k.quotesMonth.n), 'enviadas'],
      [`Clientes novos em ${mes}`, num(k.contactsMonth.n), 'cadastrados']]
      .map(([l, v, s]) => h('div.kpi', { role: 'listitem' }, h('div.l', l), h('div.v', v), h('div.small.muted', s)))));
  const grid = h('div.home'); p.append(grid);
  const tasks = h('section.card', h('div.hd', h('h3', 'Para hoje'), h('a', { href: '#/tarefas' }, 'Todas as tarefas')), h('div.list', d.tasksToday.length ? d.tasksToday.map(t =>
    h('label.li', h('input', { type: 'checkbox', 'aria-label': `Concluir: ${t.title}`, on: { change: guard(async () => { await save('tasks', { id: t.id, done: 1 }); toast('Tarefa concluída'); refresh('task'); }) } }),
      h('div.grow', h('div', t.title), h('div.small.muted', [t.time || 'Sem horário', t.type_name, t.owner_name].filter(Boolean).join(' · '))),
      t.date < today() ? h('span.badge.warn', `Desde ${date(t.date).slice(0, 5)}`) : null)) : h('div.empty.ok', 'Nada pendente para hoje.')));
  const deals = h('section.card', h('div.hd', h('h3', 'Últimos negócios'), h('a', { href: '#/negocios' }, 'Abrir o quadro')), !d.recentDeals.length ? h('div.empty', 'Nenhum negócio ainda.', h('div', { style: { marginTop: '12px' } }, h('a.btn.sm', { href: '#/negocios' }, '+ Criar o primeiro negócio'))) : h('div.list', d.recentDeals.map(x =>
    h('a.li', { href: `#/negocio/${x.id}` },
      h('div.grow', h('div', x.title), h('div.small.muted', [x.contact_name, x.stage_name].filter(Boolean).join(' · '))),
      x.status !== 'open' ? statusBadge(x.status) : null, x.amount ? h('b.money', money(x.amount).replace(/,00$/, '')) : h('span.small.muted', 'Sem valor')))));
  const frase = a => {
    const ent = labelTable(a.entity);
    if (a.action === 'alterou' && a.entity === 'tasks' && /done/.test(a.detail || '')) return 'concluiu uma tarefa';
    if (a.action === 'alterou') return `editou ${ent}`;
    if (a.action === 'criou') return `criou ${ent}${a.detail ? ` “${a.detail}”` : ''}`;
    if (a.action === 'excluiu') return `excluiu ${ent}${a.detail ? ` “${a.detail}”` : ''}`;
    if (a.action === 'moveu estágio') return `moveu um negócio para “${a.detail}”`;
    if (a.action === 'novo lead') return `recebeu um lead pela ${a.detail || 'internet'}`;
    return `${a.action}${a.detail && !/^\d+$/.test(a.detail) ? ` · ${a.detail}` : ''}`;
  };
  const act = h('section.card', h('div.hd', h('h3', 'Atividade da equipe')), d.activity.length ? h('div.bd.timeline', d.activity.map(a =>
    h('div.ev', h('div.dot', initials(a.user_name || 'Sistema')), h('div', h('div.tl', h('span', h('b', a.user_name || 'Sistema'), ' ', frase(a)), h('span.when', dateTime(a.at)))))))
    : h('div.empty', 'Quando alguém da equipe mexer em um negócio, aparece aqui.'));
  grid.append(h('div.col.gap', tasks, act), deals);
}
const labelTable = t => ({ deals: 'negócio', contacts: 'cliente', tasks: 'tarefa', docs: 'documento', interactions: 'interação', charts: 'gráfico', products: 'produto', users: 'usuário', report_panels: 'painel', tabs: 'aba', options: 'opção', stages: 'estágio', pipelines: 'funil', goals: 'meta' }[t] || t || '');

// =================== METAS ===================
export async function goalsPage(content) {
  let offset = 0;
  const p = page(content, 'Metas', [
    h('div.row', { style: { gap: '2px' } }, h('button.iconbtn', { title: 'Período anterior', 'aria-label': 'Período anterior', on: { click: () => { offset--; draw(); } } }, 'ph:caret-left'),
      h('button.btn.sm', { on: { click: () => { offset = 0; draw(); } } }, 'Este período'),
      h('button.iconbtn', { title: 'Próximo período', 'aria-label': 'Próximo período', on: { click: () => { offset++; draw(); } } }, 'ph:caret-right')),
    ['Administrador', 'Gestor'].includes(state.me?.role) ? h('button.btn.pri', { on: { click: () => goalForm({}) } }, '+ Nova meta') : null],
  h('div.subtabs', h('a', { href: '#/' }, 'Resumo'), h('a.on', { href: '#/metas' }, 'Metas')));
  const box = h('div.goals'); p.append(box);
  async function draw() {
    const goals = await api(`/goals?offset=${offset}`);
    clear(box);
    if (!goals.length) return box.append(h('div.tablewrap', h('div.empty', 'Nenhuma meta ainda. Crie uma para acompanhar vendas, negócios ganhos ou interações da equipe.')));
    const PERIODO = { day: 'dias', week: 'semanas', month: 'meses', bimester: 'bimestres', quarter: 'trimestres', quadrimester: 'quadrimestres', semester: 'semestres', year: 'anos' };
    const gestor = ['Administrador', 'Gestor'].includes(state.me?.role);
    for (const g of goals) {
      const pr = g.progress; const isMoney = /total|amount|price/.test(g.field || '');
      const fmtV = v => (isMoney ? money(v) : num(v, 1));
      const max = Math.max(g.target, ...g.history.map(x => x.value)) || 1;
      box.append(h('div.card', h('div.hd', h('h3', g.name), !gestor ? null : h('button.iconbtn', { title: 'Ações da meta', 'aria-label': `Ações da meta ${g.name}`, on: { click: e => menu(e.currentTarget, [
        { label: 'Editar', icon: '✎', click: () => goalForm(g) },
        { label: 'Excluir', icon: '🗑', danger: true, click: guard(async () => { if (await confirmDialog(`Excluir a meta "${g.name}"?`)) { await del('goals', g.id); draw(); } }) }]) } }, '⋯')),
        h('div.bd.col',
          h('div.small.muted', `${date(pr.from)} a ${date(pr.to)} · ${g.user_name || g.team_name || 'Empresa'}`),
          h('div.metaval', h('b', g.percent_only ? `${num(pr.pct, 1)}%` : fmtV(pr.value)), g.percent_only ? null : h('span.muted', `de ${isMoney ? moneyShort(g.target) : num(g.target, 1)}`), h('span.grow'), h(`span.badge.${pr.pct >= 100 ? 'won' : 'open'}`, `${num(pr.pct, 1)}%`)),
          h('div.progress', h('i', { style: { width: `${Math.min(100, pr.pct)}%`, background: g.color || 'var(--acc)' } })),
          h('div.row', { style: { alignItems: 'flex-end', height: '60px', gap: '4px', marginTop: '6px' } }, g.history.map(x =>
            h('div', { title: `${date(x.from)}: ${fmtV(x.value)} (${num(x.pct, 1)}% da meta)`, style: { flex: 1, height: `${Math.max(3, (x.value / max) * 56)}px`, borderRadius: '3px',
              background: x.value >= g.target ? (g.color || 'var(--accent)') : `color-mix(in srgb, ${g.color || 'var(--accent)'} 35%, var(--surface-3))` } }))),
          h('div.small.muted', `${g.interval === 'week' ? 'Últimas' : 'Últimos'} 6 ${PERIODO[g.interval] || 'períodos'} · barra cheia = meta batida`))));
    }
  }
  draw();
  window.addEventListener('lente:goals', draw, { once: true });
}
function goalForm(g) {
  const entities = Object.values(ENTITIES).filter(e => !['user', 'product'].includes(e.key));
  const name = h('input.i', { value: g.name || '', maxLength: 150 });
  let entity = g.entity || 'order';
  const entSel = sel(entities.map(e => ({ id: e.key, name: e.label })), entity, { empty: null, onchange: v => { entity = v; drawFields(); } });
  const aggSel = sel(AGGREGATORS, g.aggregator || 'sum', { empty: null });
  const fieldBox = h('div'), dateBox = h('div'), filtBox = h('div');
  let fieldSel, dateSel, fb;
  const drawFields = () => {
    const e = ENTITIES[entity];
    fieldSel = sel(e.fields.filter(([, , t]) => NUMERIC.has(t)).map(([k, l]) => ({ id: k, name: l })), g.entity === entity ? g.field : e.idField, { empty: null });
    dateSel = sel(e.fields.filter(([, , t]) => t === 'date').map(([k, l]) => ({ id: k, name: l })), g.entity === entity ? g.date_field : e.dateField, { empty: null });
    fb = filterBuilder(entity, g.entity === entity ? g.filter : null);
    clear(fieldBox).append(field('Campo', fieldSel)); clear(dateBox).append(field('Campo de data considerado', dateSel)); clear(filtBox).append(fb.el);
  };
  drawFields();
  const user = sel(state.meta.users, g.user_id, { empty: 'Toda a empresa' }); const team = sel(state.meta.teams, g.team_id, { empty: '—' });
  const target = h('input.i', { type: 'number', value: g.target || '' }); const start = h('input.i', { type: 'date', value: g.start_date || today() });
  const end = h('input.i', { type: 'date', value: g.end_date || `${new Date().getFullYear()}-12-31` });
  const interval = sel([['day', 'Diária'], ['week', 'Semanal'], ['month', 'Mensal'], ['bimester', 'Bimestral'], ['quarter', 'Trimestral'], ['quadrimester', 'Quadrimestral'], ['semester', 'Semestral'], ['year', 'Anual']].map(([id, name]) => ({ id, name })), g.interval || 'month', { empty: null });
  const color = h('input.i', { type: 'color', value: g.color || '#fca311', style: { height: '36px' } });
  const pct = sel([{ id: 0, name: 'Não' }, { id: 1, name: 'Sim' }], g.percent_only || 0, { empty: null });
  const step = (n, l, inp) => h('div.row', { style: { alignItems: 'flex-start' } }, h('span.avatar', n), h('div.grow', field(l, inp)));
  const m = modal(g.id ? 'Editar meta' : 'Nova meta', h('div.col',
    step(1, 'Qual o nome da meta?', name), step(2, 'Qual dado você deseja metrificar? (entidade)', entSel), h('div', { style: { marginLeft: '38px' } }, fieldBox),
    step(3, 'Como agregar os dados?', aggSel), step(4, 'Quem tem que atingir a meta? (usuário)', user), step(5, 'Ou uma equipe', team),
    step(6, 'Valor da meta por intervalo', target), step(7, 'Data de início', start), step(8, 'Data de término', end),
    h('div', { style: { marginLeft: '38px' } }, dateBox), step(9, 'Como o intervalo deve ser separado?', interval), step(10, 'Cor da meta', color),
    step(11, 'Exibir a meta apenas em porcentagem?', pct), h('details', h('summary', 'Filtro adicional (opcional)'), filtBox)), {
    size: 'mid', foot: [h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => {
      if (!name.value.trim() || !target.value) throw new Error('Informe nome e valor da meta');
      await save('goals', { id: g.id, panel_id: g.panel_id || 1, name: name.value.trim(), entity, aggregator: aggSel.value, field: fieldSel.value, date_field: dateSel.value,
        user_id: user.value || null, team_id: team.value || null, target: +target.value, start_date: start.value, end_date: end.value, interval: interval.value,
        color: color.value, percent_only: +pct.value, filter: JSON.stringify(fb.value()) });
      m.close(); toast('Meta salva'); refresh();
    }) } }, 'Salvar')] });
}

// =================== CLIENTES ===================
export async function contactsPage(content) {
  const p = page(content, 'Clientes', [
    maisAcoes([{ label: 'Importar clientes (CSV)', icon: '⇪', click: importContacts },
      ehAdmin() ? { label: 'Segmentos, origens e status', icon: '⚙', click: () => go('#/administracao/opcoes') } : null]),
    h('button.btn.pri', { on: { click: e => menu(e.currentTarget, [
      { label: 'Empresa', icon: '🏢', click: () => contactForm({ type: 'company' }) }, { label: 'Pessoa', icon: '👤', click: () => contactForm({ type: 'person' }) }]) } }, '+ Novo cliente')]);
  await dataList(p, {
    module: 'contacts', entity: 'contact', sort: 'contact_name', searchPlaceholder: 'Nome, CPF/CNPJ, e-mail, telefone…',
    searchKeys: ['contact_name', 'contact_doc', 'contact_email', 'contact_phone', 'contact_city'],
    tabsDefault: [{ name: 'Empresas', filter: JSON.stringify({ conditions: [{ field: 'contact_type', op: 1, value: ['Empresa'], group: 1 }] }) },
      { name: 'Pessoas', filter: JSON.stringify({ conditions: [{ field: 'contact_type', op: 1, value: ['Pessoa'], group: 1 }] }) }, { name: 'Todos', filter: '{}' }],
    columns: [['contact_name', 'Nome'], ['contact_type', 'Tipo'], ['contact_owner', 'Responsável'], ['contact_city', 'Cidade'], ['contact_state', 'UF'],
      ['contact_last_contact', 'Último contato'], ['contact_status', 'Status']],
    onOpen: r => go(`#/cliente/${r.contact_id}`),
  });
}
export function contactForm(c) {
  const company = c.type === 'company';
  const f = form(company ? [
    { key: 'name', label: 'Nome', required: true, max: 200 }, { key: 'legal_name', label: 'Razão social', max: 200 }, { key: 'doc', label: 'CNPJ' },
    { key: 'segment_id', label: 'Segmento', type: 'option:segment' }, { key: 'origin_id', label: 'Origem', type: 'option:origin' },
    { key: 'status_id', label: 'Status', type: 'option:contact_status' }, { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail', type: 'email' },
    { key: 'city', label: 'Cidade' }, { key: 'state', label: 'UF', max: 2 }, { key: 'address', label: 'Endereço', span: 1 }, { key: 'owner_id', label: 'Responsável', type: 'user', required: true },
    { key: 'notes', label: 'Outras informações', type: 'textarea', span: 1 }] : [
    { key: 'name', label: 'Nome', required: true, max: 200 }, { key: 'company_id', label: 'Empresa', type: 'company' }, { key: 'doc', label: 'CPF' },
    { key: 'email', label: 'E-mail', type: 'email' }, { key: 'phone', label: 'Telefone' }, { key: 'role_title', label: 'Cargo' },
    { key: 'origin_id', label: 'Origem', type: 'option:origin' }, { key: 'owner_id', label: 'Responsável', type: 'user', required: true },
    { key: 'city', label: 'Cidade' }, { key: 'state', label: 'UF', max: 2 }, { key: 'notes', label: 'Outras informações', type: 'textarea', span: 1 }], c);
  const m = modal(c.id ? `Editar ${company ? 'empresa' : 'pessoa'}` : company ? 'Nova empresa' : 'Nova pessoa', f.el, { size: 'mid', foot: [
    h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'),
    h('button.btn.pri', { on: { click: guard(async () => { const v = f.value(); if (v.state) v.state = v.state.toUpperCase(); const r = await save('contacts', { ...v, id: c.id, type: c.type }); m.close(); toast('Cliente salvo'); invalidate('contact'); if (!c.id) go(`#/cliente/${r.id}`); else refresh('contact'); }) } }, 'Salvar')] });
}
function importContacts() {
  const ta = h('textarea.i', { style: { minHeight: '200px' }, placeholder: 'nome;tipo(empresa|pessoa);cnpj/cpf;email;telefone;cidade;uf\nGrupo Exemplo;empresa;12.345.678/0001-90;contato@exemplo.com;(71) 3333-0000;Salvador;BA' });
  const file = h('input', { type: 'file', accept: '.csv,.txt', on: { change: async e => { ta.value = await e.target.files[0].text(); } } });
  const m = modal('Importar clientes (CSV)', h('div.col', h('p.muted', 'Colunas separadas por ";" na ordem: nome; tipo; CPF/CNPJ; e-mail; telefone; cidade; UF. A primeira linha pode ser cabeçalho.'), file, ta), {
    size: 'mid', foot: [h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => {
      const lines = ta.value.split(/\r?\n/).map(l => l.split(';').map(x => x.trim())).filter(l => l[0]);
      if (lines[0] && /nome/i.test(lines[0][0])) lines.shift();
      if (!lines.length) throw new Error('Nenhuma linha com nome para importar.');
      const rows = lines.map(([name, type, doc, email, phone, city, uf]) => ({ name, type: /pess/i.test(type || '') ? 'person' : 'company', doc, email, phone, city, state: (uf || '').toUpperCase().slice(0, 2) }));
      const r = await api('/import/contacts', { body: { rows } });
      m.close(); refresh('contact');
      toast(r.total_erros ? `${r.criados} clientes importados · ${r.total_erros} linha(s) com erro (ex.: linha ${r.erros[0].linha}: ${r.erros[0].motivo})` : `${r.criados} clientes importados`, !!r.total_erros && !r.criados);
    }) } }, 'Importar')] });
}
export async function contactDetail(content, id) {
  const d = await api(`/contact/${id}/full`); const c = d.contact;
  const p = h('div.page'); content.append(p);
  p.append(h('div.pagehead', h('a', { href: '#/clientes' }, '← Clientes'), h('span.grow')),
    h('div.row', { style: { marginBottom: '14px' } }, h('span.avatar', { style: { width: '48px', height: '48px', fontSize: '16px' } }, initials(c.name)),
      h('div.grow', h('h1', { style: { fontSize: '20px' } }, c.name), h('div.muted', `${c.type === 'company' ? 'Empresa' : 'Pessoa'}${c.company_name ? ' · ' + c.company_name : ''} · ${c.city || ''} ${c.state || ''}`)),
      h('button.btn', { on: { click: () => interactionForm({ contact_id: c.id }) } }, '☏ Registrar interação'), h('button.btn', { on: { click: () => taskForm({ contact_id: c.id }) } }, '✓ Tarefa'),
      h('button.btn.pri', { on: { click: () => dealForm({ contact_id: c.id }) } }, '+ Negócio'),
      h('button.iconbtn', { on: { click: e => menu(e.currentTarget, [{ label: 'Editar', icon: '✎', click: () => contactForm(c) },
        { label: 'Excluir', icon: '🗑', danger: true, click: guard(async () => { if (await confirmDialog(`Excluir ${c.name}?`)) { await del('contacts', c.id); invalidate('contact'); go('#/clientes'); } }) }]) } }, '⋯')));
  const tabs = [['Linha do tempo', () => timeline(d.interactions, d.tasks, [])], ['Negócios', () => dealsTable(d.deals)], ['Documentos', () => docsTable(d.docs)],
    ...(c.type === 'company' ? [['Pessoas', () => d.people.length ? h('div.tablewrap', h('table.t', h('tbody', d.people.map(x => h('tr.click', { on: { click: () => go(`#/cliente/${x.id}`) } }, h('td', x.name), h('td', x.role_title || ''), h('td', x.email || ''), h('td', x.phone || '')))))) : h('div.empty', 'Nenhuma pessoa vinculada')]] : []),
    ['Tarefas', () => tasksTable(d.tasks)]];
  const area = h('div'); const st = h('div.subtabs');
  const show = i => { st.querySelectorAll('a').forEach((a, j) => a.classList.toggle('on', i === j)); clear(area).append(tabs[i][1]()); };
  tabs.forEach(([l], i) => st.append(h('a', { href: 'javascript:void 0', on: { click: () => show(i) } }, l)));
  const info = h('div.card', h('div.hd', h('h3', 'Informações'), h('button.btn.sm', { on: { click: () => contactForm(c) } }, 'Editar')), h('div.bd', h('dl.info',
    [['CPF/CNPJ', c.doc], ['Razão social', c.legal_name], ['E-mail', c.email], ['Telefone', c.phone], ['Cargo', c.role_title], ['Segmento', c.segment_name], ['Origem', c.origin_name],
      ['Status', c.status_name], ['Responsável', c.owner_name], ['Endereço', c.address], ['Cidade/UF', `${c.city || ''} ${c.state || ''}`], ['Criado em', dateTime(c.created_at)],
      ['Último contato', dateTime(c.last_contact_at)], ['Observações', c.notes]].filter(([, v]) => v && String(v).trim()).flatMap(([k, v]) => [h('dt', k), h('dd', v)]))));
  p.append(h('div.detail', h('div', st, area), h('div.col', info, h('div.card', h('div.hd', h('h3', 'Resumo')), h('div.bd', h('dl.info',
    h('dt', 'Negócios'), h('dd', d.deals.length ? `${d.deals.length} · ${d.deals.filter(x => x.status === 'won').length} ganho(s) · ${d.deals.filter(x => x.status === 'open').length} em andamento` : 'Nenhum ainda'),
    h('dt', 'Valor ganho'), h('dd', d.deals.some(x => x.status === 'won') ? money(d.deals.filter(x => x.status === 'won').reduce((a, x) => a + x.amount, 0)) : '—'),
    h('dt', 'Interações'), h('dd', d.interactions.length ? `${d.interactions.length} · última ${relativo(d.interactions[0].date)}` : 'Nenhuma ainda')))))));
  show(0);
}
function timeline(inters, tasks, history) {
  const ICONE_TIPO = { 'Ligação': 'ph:phone', 'Reunião': 'ph:users', 'Visita': 'ph:map-pin', 'E-mail': 'ph:envelope-simple', 'WhatsApp': 'ph:whatsapp-logo' };
  const ev = [...inters.map(i => ({ at: i.date, icon: ICONE_TIPO[i.type_name] || 'ph:chats-circle', title: `${i.type_name || 'Interação'} · ${i.owner_name || ''}`, text: i.description })),
    ...tasks.map(t => ({ at: `${t.date} ${t.time || ''}`, icon: t.done ? 'ph:check-circle' : 'ph:circle', title: `Tarefa: ${t.title}`, text: `${t.type_name || ''} · ${t.owner_name || ''}${t.done ? ' · finalizada' : ''}` })),
    ...history.map(x => ({ at: x.entered_at, icon: '➜', title: `Entrou no estágio ${x.stage_name}`, text: x.left_at ? `Saiu em ${dateTime(x.left_at)}` : 'Estágio atual' }))]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!ev.length) return h('div.empty', 'Nada registrado ainda. Use “Registrar interação” depois de cada ligação ou visita.');
  return h('div.card', h('div.bd.timeline', ev.map(e => h('div.ev', h('div.dot', e.icon), h('div', h('div.tl', h('b', e.title), h('span.when', dateTime(e.at))), e.text ? h('div.tx', e.text) : null)))));
}
const dealsTable = list => list.length ? h('div.tablewrap', h('table.t', h('thead', h('tr', h('th', 'Título'), h('th', 'Estágio'), h('th', 'Responsável'), h('th.num', 'Valor'), h('th', 'Situação'))),
  h('tbody', list.map(x => h('tr.click', { on: { click: () => go(`#/negocio/${x.id}`) } }, h('td', x.title), h('td', x.stage_name || ''), h('td', x.owner_name || ''), h('td.num', money(x.amount)), h('td', statusBadge(x.status))))))) : h('div.empty', 'Nenhum negócio');
const KIND = { quote: 'Proposta', order: 'Venda', document: 'Documento' };
const docsTable = list => list.length ? h('div.tablewrap', h('table.t', h('thead', h('tr', h('th', 'Tipo'), h('th', 'Nº'), h('th', 'Título'), h('th', 'Data'), h('th.num', 'Total'), h('th', 'Situação'))),
  h('tbody', list.map(x => h('tr.click', { on: { click: () => go(`#/doc/${x.id}`) } }, h('td', KIND[x.kind]), h('td', `${x.number}${x.revision > 1 ? ` (rev. ${x.revision})` : ''}`), h('td', x.title || ''), h('td', date(x.date)), h('td.num', money(x.total)), h('td', docStatus(x.status))))))) : h('div.empty', 'Nenhum documento');
const tasksTable = list => list.length ? h('div.tablewrap', h('table.t', h('tbody', list.map(t => h('tr', h('td', h('input', { type: 'checkbox', checked: !!t.done, on: { change: guard(async e => { await save('tasks', { id: t.id, done: e.target.checked ? 1 : 0 }); invalidate('task'); toast('Tarefa atualizada'); }) } })),
  h('td', t.title), h('td', `${date(t.date)} ${t.time || ''}`), h('td', t.type_name || ''), h('td', t.owner_name || ''), h('td', h('button.btn.sm', { on: { click: () => taskForm(t) } }, 'Editar')))))))
  : h('div.empty', 'Nenhuma tarefa');

// =================== NEGÓCIOS ===================
export async function dealsPage(content, pipelineId) {
  const pipes = state.meta.pipelines.filter(p => !p.archived);
  const pipe = pipes.find(p => p.id === +pipelineId) || pipes.find(p => p.favorite) || pipes[0];
  if (!pipe) return page(content, 'Negócios', [h('a.btn.pri', { href: '#/funis' }, 'Criar funil')]);
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const view = qs.get('view') || 'funil';
  let pref = { status: ['open', 'won', 'lost'], mine: 'all', sort: 'created' };
  try { Object.assign(pref, JSON.parse(localStorage.getItem('lente-deals') || '{}')); } catch {}
  const savePref = () => { try { localStorage.setItem('lente-deals', JSON.stringify(pref)); } catch {} };
  const pipeBtn = h('button.btn', { 'aria-label': `Funil: ${pipe.name}. Trocar de funil`, on: { click: e => menu(e.currentTarget, [{ header: 'Funis' }, ...pipes.map(x => ({ label: x.name, icon: x.favorite ? '★' : '', click: () => go(`#/negocios/${x.id}${view === 'tabela' ? '?view=tabela' : ''}`) })), '-', { label: 'Gerenciar funis', icon: '⚙', click: () => go('#/funis') }]) } }, `${pipe.name} ▾`);
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Visualização' },
    h(`a${view === 'tabela' ? '' : '.on'}`, { href: `#/negocios/${pipe.id}`, 'aria-current': view === 'tabela' ? null : 'page' }, 'ph:kanban Quadro'),
    h(`a${view === 'tabela' ? '.on' : ''}`, { href: `#/negocios/${pipe.id}?view=tabela`, 'aria-current': view === 'tabela' ? 'page' : null }, 'ph:table Tabela'));
  const p = page(content, 'Negócios', [seg, pipeBtn,
    view === 'funil' ? h('button.btn', { on: { click: e => menu(e.currentTarget, [
      { header: 'Situação dos negócios' }, ...[['open', 'Em andamento'], ['won', 'Ganhos'], ['lost', 'Perdidos']].map(([k, l]) => ({ label: l, icon: pref.status.includes(k) ? '☑' : '☐', click: () => { pref.status = pref.status.includes(k) ? pref.status.filter(x => x !== k) : [...pref.status, k]; savePref(); draw(); } })),
      { header: 'Responsáveis' }, ...[['all', 'Todos'], ['mine', 'Meus negócios'], ['others', 'Negócios dos outros']].map(([k, l]) => ({ label: l, icon: pref.mine === k ? '◉' : '○', click: () => { pref.mine = k; savePref(); draw(); } })),
      { header: 'Ordenação' }, ...[['created', 'Data de criação'], ['next_task', 'Data da próxima tarefa'], ['amount_desc', 'Valor (maior → menor)'], ['amount_asc', 'Valor (menor → maior)'], ['title_asc', 'Título (A–Z)'], ['title_desc', 'Título (Z–A)'], ['days', 'Dias no estágio']]
        .map(([k, l]) => ({ label: l, icon: pref.sort === k ? '◉' : '○', click: () => { pref.sort = k; savePref(); draw(); } }))]) } }, 'ph:sliders-horizontal Filtrar e ordenar') : null,
    h('button.iconbtn', { title: 'Configurar funil', 'aria-label': 'Configurar funil', on: { click: e => menu(e.currentTarget, [{ label: 'Configurar funil e estágios', icon: '⚙', click: () => pipelineEditor(pipe) }, { label: 'Motivos de perda', icon: '✎', click: () => go('#/administracao/opcoes') }]) } }, '⚙'),
    h('button.btn.pri', { on: { click: () => dealForm({ pipeline_id: pipe.id }) } }, '+ Novo negócio')]);
  if (view === 'tabela') {
    await dataList(p, { module: `deals-${pipe.id}`, entity: 'deal', sort: 'deal_create_date', extraFilter: r => r.deal_pipeline === pipe.name,
      tabsDefault: [['Negócios em aberto', 'Em andamento'], ['Negócios ganhos', 'Ganho'], ['Negócios perdidos', 'Perdido']].map(([name, v]) => ({ name, filter: JSON.stringify({ conditions: [{ field: 'deal_status', op: 1, value: [v], group: 1 }] }) })),
      columns: [['deal_title', 'Título'], ['contact_name', 'Cliente'], ['deal_owner', 'Responsável'], ['deal_amount', 'Valor'], ['deal_stage', 'Estágio'], ['deal_days_in_stage', 'Dias no estágio'], ['deal_create_date', 'Criado em']],
      onOpen: r => go(`#/negocio/${r.deal_id}`) });
    return;
  }
  const board = h('div.kanban'); p.append(board);
  const [rowsAll, tasks] = await Promise.all([rowsOf('deal', true), rowsOf('task', true)]);
  const nextTask = {}; for (const t of tasks) if (t.task_status === 'Aberta' && t.deal_title) { const k = t.deal_title; if (!nextTask[k] || t.task_date < nextTask[k]) nextTask[k] = t.task_date; }
  const deals = await api(`/t/deals?pipeline_id=${pipe.id}`);
  const byId = Object.fromEntries(rowsAll.map(r => [r.deal_id, r]));
  function draw() {
    clear(board);
    let list = deals.filter(d => pref.status.includes(d.status));
    if (pref.mine === 'mine') list = list.filter(d => d.owner_id === state.me.id); else if (pref.mine === 'others') list = list.filter(d => d.owner_id !== state.me.id);
    const sorters = { created: (a, b) => b.created_at.localeCompare(a.created_at), amount_desc: (a, b) => b.amount - a.amount, amount_asc: (a, b) => a.amount - b.amount,
      title_asc: (a, b) => a.title.localeCompare(b.title), title_desc: (a, b) => b.title.localeCompare(a.title), days: (a, b) => a.stage_changed_at.localeCompare(b.stage_changed_at),
      next_task: (a, b) => String(nextTask[a.title] || '9').localeCompare(String(nextTask[b.title] || '9')) };
    list.sort(sorters[pref.sort] || sorters.created);
    list.sort((a, b) => (a.status !== 'open') - (b.status !== 'open')); // fechados (ganhos/perdidos) no fim da coluna
    for (const s of pipe.stages) {
      const items = list.filter(d => d.stage_id === s.id);
      const total = items.reduce((a, d) => a + (d.amount || 0), 0);
      const col = h('div.kcol', { dataset: { stage: s.id } }, h('div.kh', h('div.row', h('b', s.name), h('span.count', { 'aria-label': `${items.length} negócios` }, items.length)), h('small', { title: money(total) }, moneyShort(total))));
      const bd = h('div.kb');
      items.slice(0, 200).forEach(d => {
        const r = byId[d.id] || {};
        const dias = r.deal_days_in_stage ?? 0, prox = nextTask[d.title], atrasada = prox && prox < today();
        // rodapé: valor · próxima tarefa (ou há quanto tempo está parado) · responsável
        const sinal = prox ? h(`span${atrasada ? '.late' : ''}`, { title: atrasada ? 'Tarefa atrasada' : 'Próxima tarefa' }, `⏰ ${date(prox).slice(0, 5)}`)
          : d.status === 'open' && dias >= 21 ? h('span.late', { title: 'Sem mudar de estágio' }, `parado há ${dias} dias`)
          : d.status === 'open' && dias >= 7 ? h('span', `há ${dias} dias`) : null;
        const card = h(`a.kcard.${d.status}`, { href: `#/negocio/${d.id}`, draggable: true, on: { dragstart: e => { e.dataTransfer.setData('text/plain', d.id); } } },
          h('div.tt', d.title), h('div.cli', r.contact_name || 'Sem cliente'),
          (d.source || d.returns || d.last_message) ? h('div.lead', chipOrigem(d.platform, d.source), d.returns ? h('span.src.ret', { title: 'Voltou a chamar' }, `↻ voltou ${d.returns}×`) : null,
            d.last_message ? h('q', { title: d.last_message }, d.last_message) : null) : null,
          h('div.ft', d.amount ? h('b.money', money(d.amount).replace(/,00$/, '')) : h('span.muted', 'Sem valor'), h('span.sig', sinal), h('span.avatar.xs', { title: r.deal_owner || '' }, initials(r.deal_owner || '?'))));
        card.addEventListener('dragstart', () => card.classList.add('dragging')); card.addEventListener('dragend', () => card.classList.remove('dragging'));
        bd.append(card);
      });
      if (!items.length) bd.append(h('p.kempty', 'Arraste um negócio para cá quando ele chegar nesta etapa.'));
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', guard(async e => {
        e.preventDefault(); col.classList.remove('drop');
        const id = +e.dataTransfer.getData('text/plain'); const d = deals.find(x => x.id === id);
        if (!d || d.stage_id === s.id) return;
        await api(`/deals/${id}/move`, { body: { stage_id: s.id } }); d.stage_id = s.id; d.stage_changed_at = new Date().toISOString(); invalidate('deal'); draw(); toast(`Movido para "${s.name}"`);
      }));
      col.append(bd); board.append(col);
    }
  }
  draw();
}
export function dealForm(d) {
  const pipes = state.meta.pipelines.filter(p => !p.archived);
  const pipeId = d.pipeline_id || pipes[0]?.id;
  const stageSel = sel(pipes.find(p => p.id === +pipeId)?.stages || [], d.stage_id, { empty: null });
  const f = form([{ key: 'title', label: 'Título', required: true, max: 200, span: 1 }, { key: 'contact_id', label: 'Cliente', type: 'contact' },
    { key: 'pipeline_id', label: 'Funil', type: 'pipeline' }, { key: 'amount', label: 'Valor (R$)', type: 'money' }, { key: 'origin_id', label: 'Origem', type: 'option:origin' },
    { key: 'owner_id', label: 'Responsável', type: 'user', required: true }, { key: 'start_date', label: 'Início', type: 'date', default: today() },
    { key: 'end_date', label: 'Previsão de término', type: 'date' }, { key: 'notes', label: 'Outras informações', type: 'textarea', span: 1 }], { ...d, pipeline_id: pipeId });
  f.inputs.pipeline_id.addEventListener('change', () => { const s = pipes.find(p => p.id === +f.inputs.pipeline_id.value)?.stages || []; clear(stageSel); s.forEach(x => stageSel.append(h('option', { value: x.id }, x.name))); });
  if (!d.id) f.el.append(field('Estágio inicial', stageSel));
  const m = modal(d.id ? 'Editar negócio' : 'Novo negócio', f.el, { size: 'mid', foot: [h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'),
    h('button.btn.pri', { on: { click: guard(async () => { const v = f.value(); if (!d.id) v.stage_id = +stageSel.value; const r = await save('deals', { ...v, id: d.id }); m.close(); toast('Negócio salvo'); invalidate('deal'); if (!d.id) go(`#/negocio/${r.id}`); else refresh('deal'); }) } }, 'Salvar')] });
}
export async function dealDetail(content, id) {
  const d = await api(`/deal/${id}/full`); const x = d.deal;
  const p = h('div.page'); content.append(p);
  const cur = d.stages.findIndex(s => s.id === x.stage_id);
  const setStatus = guard(async (status) => {
    let loss = null;
    if (status === 'lost') {
      const s = sel(opts('loss_reason'), '', { empty: 'Selecione o motivo' });
      loss = await new Promise(res => { const m = modal('Marcar como perdido', field('Motivo de perda', s), { foot: [h('button.btn', { on: { click: () => { m.close(); res(undefined); } } }, 'Cancelar'), h('button.btn.pri', { on: { click: () => { m.close(); res(s.value || null); } } }, 'Confirmar')] }); });
      if (loss === undefined) return;
    }
    await api(`/deals/${x.id}/status`, { body: { status, loss_reason_id: loss } }); toast('Situação atualizada'); refresh('deal');
  });
  p.append(h('div.pagehead', h('a.back', { href: `#/negocios/${x.pipeline_id}` }, `ph:arrow-left ${x.pipeline_name}`), h('span.grow')),
    h('div.row.wrap', h('div.grow', h('h1', { style: { fontSize: '20px' } }, x.title), h('div.muted', h('a', { href: `#/cliente/${x.contact_id}` }, x.contact_name || ''), ` · ${x.owner_name || ''} · criado em ${date(x.created_at)}`)),
      h('b', { style: { fontSize: '20px' } }, money(x.amount)), statusBadge(x.status),
      x.status === 'open' ? [h('button.btn.ok', { on: { click: () => setStatus('won') } }, '✔ Ganhar'), h('button.btn.danger', { on: { click: () => setStatus('lost') } }, '✕ Perder')] : h('button.btn', { on: { click: () => setStatus('open') } }, '↺ Reabrir'),
      h('button.iconbtn', { on: { click: e => menu(e.currentTarget, [{ label: 'Editar', icon: '✎', click: () => dealForm(x) },
        { label: 'Excluir', icon: '🗑', danger: true, click: guard(async () => { if (await confirmDialog('Excluir este negócio?')) { await del('deals', x.id); invalidate('deal'); go(`#/negocios/${x.pipeline_id}`); } }) }]) } }, '⋯')),
    h('div.stagebar', d.stages.map((s, i) => h(`button${i < cur ? '.done' : i === cur ? '.cur' : ''}`, { title: `Mover para ${s.name}`, on: { click: guard(async () => { if (i === cur) return; await api(`/deals/${x.id}/move`, { body: { stage_id: s.id } }); toast(`Movido para "${s.name}"`); refresh('deal'); }) } }, s.name))),
    x.status === 'lost' ? h('div.callout.bad', 'ph:x-circle', h('span', `Perdido${x.closed_at ? ` em ${date(x.closed_at)}` : ''} · motivo: `, h('b', x.loss_reason_name || 'não informado'))) : x.status === 'won' ? h('div.callout.good', 'ph:check-circle', h('span', `Ganho${x.closed_at ? ` em ${date(x.closed_at)}` : ''}`)) : '');
  const tabs = [['Linha do tempo', () => timeline(d.interactions, d.tasks, d.history)],
    ['Propostas', () => h('div.col', h('div.row', h('button.btn.pri', { on: { click: () => go(`#/doc/novo/quote?deal=${x.id}`) } }, '+ Nova proposta'), h('button.btn', { on: { click: () => go(`#/doc/novo/document?deal=${x.id}`) } }, '+ Novo documento')), docsTable(d.docs))],
    ['Tarefas', () => h('div.col', h('div', h('button.btn.pri', { on: { click: () => taskForm({ deal_id: x.id, contact_id: x.contact_id }) } }, '+ Nova tarefa')), tasksTable(d.tasks))]];
  const area = h('div'); const st = h('div.subtabs');
  const show = i => { st.querySelectorAll('a').forEach((a, j) => a.classList.toggle('on', i === j)); clear(area).append(tabs[i][1]()); };
  tabs.forEach(([l], i) => st.append(h('a', { href: 'javascript:void 0', on: { click: () => show(i) } }, l)));
  const checklist = (() => { try { return JSON.parse(d.stages[cur]?.checklist || '[]'); } catch { return []; } })();
  p.append(h('div.detail', h('div', h('div.row', { style: { margin: '12px 0' } }, h('button.btn', { on: { click: () => interactionForm({ deal_id: x.id, contact_id: x.contact_id }) } }, '☏ Registrar interação'),
    h('button.btn', { on: { click: () => taskForm({ deal_id: x.id, contact_id: x.contact_id }) } }, '✓ Agendar tarefa')), st, area),
  h('div.col', h('div.card', h('div.hd', h('h3', 'Informações'), h('button.btn.sm', { on: { click: () => dealForm(x) } }, 'Editar')), h('div.bd', h('dl.info',
    [['Funil', x.pipeline_name], ['Estágio', d.stages[cur]?.name], ['Cliente', x.contact_name], ['Responsável', x.owner_name], ['Origem', x.origin_name], ['Valor', money(x.amount)],
      ['Início', date(x.start_date)], ['Previsão', date(x.end_date)], ['Fechado em', dateTime(x.closed_at)], ['No estágio desde', dateTime(x.stage_changed_at)], ['Observações', x.notes]]
      .filter(([, v]) => v).flatMap(([k, v]) => [h('dt', k), h('dd', v)])))),
  x.source ? h('div.card', h('div.hd', h('h3', 'Origem do lead'), chipOrigem(x.platform, x.source)), h('div.bd.col',
    h('dl.info', [['Entrada', x.source === 'lp' ? 'Landing page' : 'WhatsApp'], ['Plataforma', PLAT[x.platform]?.[1]], ['Anúncio', x.ad_title], ['Id do anúncio', x.ad_id],
      ['Link do anúncio', x.ad_url ? h('a', { href: x.ad_url, target: '_blank', rel: 'noopener' }, 'abrir') : null], ['UTM source', x.utm_source], ['UTM medium', x.utm_medium], ['UTM campaign', x.utm_campaign],
      ['UTM content', x.utm_content], ['UTM term', x.utm_term], ['Retornos', x.returns || null], ['Fonte mais recente', x.recent_ad_title ? `${PLAT[x.recent_platform]?.[1] || ''} · ${x.recent_ad_title} (${dateTime(x.recent_at)})` : null],
      ['Última mensagem', x.last_message ? `“${x.last_message}” · ${dateTime(x.last_message_at)}` : null]].filter(([, v]) => v).flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
    x.contact_phone ? h('a.btn', { href: `https://wa.me/${String(x.contact_phone).replace(/\D/g, '').replace(/^(?!55)/, '55')}`, target: '_blank', rel: 'noopener', style: { justifyContent: 'center' } }, '✆ Abrir conversa no WhatsApp') : null)) : null,
  checklist.length ? h('div.card', h('div.hd', h('h3', `Checklist — ${d.stages[cur].name}`)), h('div.bd', checklist.map(c => h('label.row', h('input', { type: 'checkbox' }), c)))) : null)));
  show(0);
}

// =================== FUNIS ===================
export async function pipelinesPage(content) {
  await loadMeta();
  const p = page(content, 'Funis', [h('button.btn.pri', { on: { click: guard(async () => { const n = await promptDialog('Novo funil'); if (!n) return; const r = await save('pipelines', { name: n, ord: 99 });
    for (const [i, s] of ['Novo', 'Qualificação', 'Proposta', 'Fechamento'].entries()) await save('stages', { pipeline_id: r.id, name: s, ord: i }); await loadMeta(); refresh(); }) } }, '+ Novo funil')]);
  const counts = {}; for (const d of await rowsOf('deal', true)) counts[d.deal_pipeline] = (counts[d.deal_pipeline] || 0) + 1;
  for (const [title, list] of [['Favoritos', state.meta.pipelines.filter(x => x.favorite && !x.archived)], ['Ativos', state.meta.pipelines.filter(x => !x.archived)], ['Arquivados', state.meta.pipelines.filter(x => x.archived)]]) {
    p.append(h('h3', { style: { margin: '16px 0 8px' } }, `${title} · ${list.length}`));
    if (!list.length) { p.append(h('div.muted', title === 'Favoritos' ? 'Para favoritar um funil, clique na estrela do card.' : 'Nenhum funil.')); continue; }
    p.append(h('div.goals', list.map(x => h('div.card', h('div.hd', h('button.iconbtn', { title: 'Favoritar', on: { click: guard(async () => { await save('pipelines', { id: x.id, favorite: x.favorite ? 0 : 1 }); await loadMeta(); refresh(); }) } }, x.favorite ? '★' : '☆'),
      h('h3', h('a', { href: `#/negocios/${x.id}` }, x.name)), h('button.iconbtn', { on: { click: e => menu(e.currentTarget, [
        { label: 'Editar estágios', icon: '✎', click: () => pipelineEditor(x) },
        { label: x.archived ? 'Desarquivar' : 'Arquivar', icon: '🗄', click: guard(async () => { await save('pipelines', { id: x.id, archived: x.archived ? 0 : 1 }); await loadMeta(); refresh(); }) },
        { label: 'Excluir', icon: '🗑', danger: true, click: guard(async () => { if (counts[x.name]) throw new Error('Funil com negócios não pode ser excluído; arquive-o.'); if (await confirmDialog(`Excluir o funil ${x.name}?`)) { await del('pipelines', x.id); await loadMeta(); refresh(); } }) }]) } }, '⋯')),
    h('div.bd', h('div.muted', `${counts[x.name] || 0} negócios`), h('div.small', x.stages.map(s => s.name).join(' → ')))))));
  }
}
function pipelineEditor(pipe) {
  const stages = pipe.stages.map(s => ({ ...s, checklist: (() => { try { return JSON.parse(s.checklist || '[]').join('\n'); } catch { return ''; } })() }));
  const name = h('input.i', { value: pipe.name });
  const list = h('div.col');
  const draw = () => { clear(list); stages.forEach((s, i) => list.append(h('div.card', h('div.bd.grid2',
    field(`Estágio ${i + 1}`, h('input.i', { value: s.name, on: { input: e => { s.name = e.target.value; } } })),
    field('Checklist (um item por linha)', h('textarea.i', { value: s.checklist, style: { minHeight: '38px' }, on: { input: e => { s.checklist = e.target.value; } } })),
    h('div.row.span2', h('button.btn.sm', { disabled: !i, on: { click: () => { [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; draw(); } } }, '↑'),
      h('button.btn.sm', { disabled: i === stages.length - 1, on: { click: () => { [stages[i + 1], stages[i]] = [stages[i], stages[i + 1]]; draw(); } } }, '↓'),
      h('button.btn.sm.danger', { on: { click: () => { s._del = true; stages.splice(i, 1); removed.push(s); draw(); } } }, 'Remover')))))); };
  const removed = [];
  draw();
  const m = modal(`Configurar funil`, h('div.col', field('Nome do funil', name), list, h('button.btn', { on: { click: () => { stages.push({ name: 'Novo estágio', checklist: '' }); draw(); } } }, '+ Estágio')), { size: 'mid', foot: [
    h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => {
      await save('pipelines', { id: pipe.id, name: name.value });
      for (const s of removed) if (s.id) await del('stages', s.id);
      for (const [i, s] of stages.entries()) await save('stages', { id: s.id, pipeline_id: pipe.id, name: s.name, ord: i, checklist: JSON.stringify(s.checklist.split('\n').map(x => x.trim()).filter(Boolean)) });
      await loadMeta(); m.close(); toast('Funil salvo'); refresh('deal');
    }) } }, 'Salvar')] });
}

// =================== DOCUMENTOS ===================
export async function docsPage(content, which) {
  const kind = { propostas: 'quote', vendas: 'order', documentos: 'document' }[which];
  const qs = new URLSearchParams(location.hash.split('?')[1] || ''); const byItem = qs.get('por') === 'produtos' && kind !== 'document';
  const label = { quote: 'proposta', order: 'venda', document: 'documento' }[kind];
  const p = page(content, 'Documentos', [
    kind !== 'document' ? h('div.seg', { role: 'group', 'aria-label': 'Agrupar' },
      h(`a${byItem ? '' : '.on'}`, { href: `#/${which}` }, 'ph:file-text Por documento'), h(`a${byItem ? '.on' : ''}`, { href: `#/${which}?por=produtos` }, 'ph:package Por produto')) : null,
    maisAcoes([ehAdmin() ? { label: 'Modelo de impressão', icon: 'ph:printer', click: () => go('#/administracao/modelo') } : null]),
    h('button.btn.pri', { on: { click: () => go(`#/doc/novo/${kind}`) } }, `+ Nova ${label === 'documento' ? 'documento' : label}`.replace('Nova documento', 'Novo documento'))],
  h('div.subtabs', [['propostas', 'Propostas'], ['vendas', 'Vendas'], ['documentos', 'Documentos']].map(([k, l]) => h(`a${k === which ? '.on' : ''}`, { href: `#/${k}` }, l))));
  if (byItem) {
    const e = `${kind}_item`;
    await dataList(p, { module: `${e}`, entity: e, sort: `${kind}_date`, columns: [[`${kind}_number`, 'Nº'], ['contact_name', 'Cliente'], [`${e}_product`, 'Produto'], [`${e}_qty`, 'Qtd.'], [`${e}_unit_price`, 'Valor unit.'], [`${e}_discount`, 'Desc. %'], [`${e}_total`, 'Total'], [`${kind}_date`, 'Data']] });
    return;
  }
  const tabsDefault = kind === 'quote' ? [['Em aberto', 'Em aberto'], ['Ganhas', 'Ganha'], ['Perdidas', 'Perdida']].map(([name, v]) => ({ name, filter: JSON.stringify({ conditions: [{ field: 'quote_status', op: 1, value: [v], group: 1 }] }) })).concat([{ name: 'Todas', filter: '{}' }]) : [{ name: kind === 'order' ? 'Vendas' : 'Documentos', filter: '{}' }];
  await dataList(p, { module: `docs-${kind}`, entity: kind, sort: `${kind}_date`,
    columns: [[`${kind}_number`, 'Número'], [`${kind}_title`, 'Título'], ['contact_name', 'Cliente'], [`${kind}_total`, 'Valor'], [`${kind}_date`, 'Data'], kind === 'order' ? [`${kind}_stage`, 'Estágio'] : [`${kind}_status`, 'Situação'], [`${kind}_owner`, 'Responsável']],
    tabsDefault, onOpen: r => go(`#/doc/${r[`${kind}_id`]}`) });
}
export async function docEditor(content, idOrKind) {
  const isNew = isNaN(+idOrKind);
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  let doc, items;
  if (isNew) {
    doc = { kind: idOrKind, status: 'open', date: today(), discount: 0, owner_id: state.me.id, deal_id: qs.get('deal') ? +qs.get('deal') : null };
    if (doc.deal_id) { const d = await api(`/deal/${doc.deal_id}/full`); doc.contact_id = d.deal.contact_id; doc.title = `${KIND[doc.kind] === 'Proposta' ? 'Proposta comercial' : KIND[doc.kind]} — ${d.deal.contact_name}`; }
    items = [];
  } else { const r = await api(`/doc/${idOrKind}/full`); doc = r.doc; items = r.items; }
  const settings = await api('/settings');
  const p = h('div.page'); content.append(p);
  const back = { quote: 'propostas', order: 'vendas', document: 'documentos' }[doc.kind];
  const f = form([{ key: 'title', label: 'Título', span: 1, max: 200 }, { key: 'deal_id', label: 'Negócio', type: 'deal' }, { key: 'contact_id', label: 'Cliente', type: 'contact' },
    { key: 'date', label: 'Data', type: 'date' }, { key: 'owner_id', label: 'Responsável', type: 'user', required: true },
    ...(doc.kind === 'order' ? [{ key: 'stage_id', label: 'Estágio da venda', type: 'option:order_stage' }] : [{ key: 'status', label: 'Situação', type: 'select', required: true, options: [{ id: 'open', name: 'Em aberto' }, { id: 'won', name: 'Ganha' }, { id: 'lost', name: 'Perdida' }] }]),
    { key: 'discount', label: 'Desconto geral (%)', type: 'number' }, { key: 'notes', label: 'Observações / condições', type: 'textarea', span: 1 }], doc);
  const products = state.meta.products;
  const tbody = h('tbody'); const totalEl = h('b');
  const recalc = () => {
    let t = 0; items.forEach(it => { it.total = Math.round((+it.qty || 0) * (+it.unit_price || 0) * (1 - (+it.discount || 0) / 100) * 100) / 100; t += it.total; });
    const disc = +f.inputs.discount.value || 0; totalEl.textContent = money(t * (1 - disc / 100));
    tbody.querySelectorAll('[data-total]').forEach((td, i) => { td.textContent = money(items[i]?.total); });
  };
  const drawItems = () => {
    clear(tbody);
    items.forEach((it, i) => tbody.append(h('tr',
      h('td', sel(products.map(x => ({ id: x.id, name: `${x.code ? x.code + ' · ' : ''}${x.name}` })), it.product_id, { empty: 'Produto…', onchange: v => { it.product_id = +v; const pr = products.find(x => x.id === +v); if (pr) it.unit_price = pr.price; drawItems(); } })),
      h('td', h('input.i', { type: 'number', value: it.qty, style: { width: '80px' }, on: { input: e => { it.qty = +e.target.value; recalc(); } } })),
      h('td', h('input.i', { type: 'number', step: '0.01', value: it.unit_price, style: { width: '120px' }, on: { input: e => { it.unit_price = +e.target.value; recalc(); } } })),
      h('td', h('input.i', { type: 'number', value: it.discount, style: { width: '80px' }, on: { input: e => { it.discount = +e.target.value; recalc(); } } })),
      h('td.num', { dataset: { total: 1 } }, money(it.total)),
      h('td', h('button.iconbtn', { on: { click: () => { items.splice(i, 1); drawItems(); } } }, '✕')))));
    recalc();
  };
  f.inputs.discount.addEventListener('input', recalc);
  drawItems();
  const saveDoc = guard(async () => {
    const v = f.value();
    const r = await api('/doc/save', { body: { doc: { ...doc, ...v, id: doc.id }, items: items.filter(i => i.product_id).map(i => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price, discount: i.discount })) } });
    toast('Documento salvo'); invalidate(doc.kind, `${doc.kind}_item`, 'deal');
    if (isNew) go(`#/doc/${r.id}`); else refresh();
  });
  p.append(h('div.pagehead', h('a', { href: `#/${back}` }, `← ${KIND[doc.kind]}s`), h('span.grow')),
    h('div.row.wrap', { style: { marginBottom: '12px' } }, h('h1.grow', { style: { fontSize: '20px' } }, isNew ? `Nova ${KIND[doc.kind].toLowerCase()}` : `${KIND[doc.kind]} nº ${doc.number}${doc.revision > 1 ? ` · revisão ${doc.revision}` : ''}`),
      !isNew ? docStatus(doc.status) : null,
      !isNew ? h('button.btn', { on: { click: () => printDoc(doc, items, settings) } }, '⎙ Imprimir / PDF') : null,
      !isNew && doc.kind === 'quote' ? h('button.btn', { on: { click: guard(async () => { const r = await api(`/doc/${doc.id}/revise`, { body: {} }); toast('Nova revisão criada'); invalidate('quote'); go(`#/doc/${r.id}`); }) } }, '⟲ Nova revisão') : null,
      !isNew && doc.kind === 'quote' && doc.status !== 'won' ? h('button.btn.ok', { on: { click: guard(async () => { if (!await confirmDialog('Marcar a proposta como ganha e gerar a venda?', 'Gerar venda')) return; const r = await api(`/doc/${doc.id}/convert`, { body: {} }); toast('Venda gerada'); invalidate(); go(`#/doc/${r.id}`); }) } }, '✔ Gerar venda') : null,
      !isNew ? h('button.btn.danger', { on: { click: guard(async () => { if (await confirmDialog('Excluir este documento?')) { await del('docs', doc.id); invalidate(doc.kind); go(`#/${back}`); } }) } }, 'Excluir') : null,
      h('button.btn.pri', { on: { click: saveDoc } }, 'Salvar')),
    h('div.card', h('div.bd', f.el)),
    h('div.card', { style: { marginTop: '14px' } }, h('div.hd', h('h3', 'Produtos e serviços'), h('button.btn.sm', { on: { click: () => { items.push({ product_id: null, qty: 1, unit_price: 0, discount: 0, total: 0 }); drawItems(); } } }, '+ Adicionar item')),
      h('div.bd', h('div', { style: { overflowX: 'auto' } }, h('table.t', h('thead', h('tr', h('th', 'Produto'), h('th', 'Qtd.'), h('th', 'Valor unit.'), h('th', 'Desc. %'), h('th.num', 'Total'), h('th', ''))), tbody)),
        h('div.row', { style: { justifyContent: 'flex-end', marginTop: '10px', fontSize: '16px' } }, 'Total: ', totalEl))));
}
function printDoc(doc, items, settings) {
  const co = settings.company || {}; const tpl = settings.doc_template || {};
  const w = window.open('', '_blank');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => esc(Number.isFinite(+v) ? +v : '');
  const sub = items.reduce((a, i) => a + i.total, 0);
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(KIND[doc.kind])} ${n(doc.number)}</title><style>
    body{font:13px/1.5 system-ui,sans-serif;color:#111;margin:40px}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}td.n,th.n{text-align:right}
    .hd{display:flex;justify-content:space-between;border-bottom:3px solid #fca311;padding-bottom:12px;margin-bottom:16px}.muted{color:#666}.tot{text-align:right;font-size:16px}</style></head><body>
    <div class="hd"><div><h1 style="color:#14213d">${esc(co.name || 'Minha Empresa')}</h1><div class="muted">${esc(co.cnpj || '')} ${esc(co.email || '')} ${esc(co.phone || '')}</div></div>
    <div style="text-align:right"><b>${esc(KIND[doc.kind])} nº ${n(doc.number)}${doc.revision > 1 ? ' rev. ' + n(doc.revision) : ''}</b><div class="muted">${esc(date(doc.date))}</div></div></div>
    <p>${esc(tpl.header || '')}</p><p><b>Cliente:</b> ${esc(doc.contact_name || '')} ${doc.contact_doc ? '· ' + esc(doc.contact_doc) : ''}<br>${esc(doc.contact_city || '')} ${esc(doc.contact_state || '')} ${esc(doc.contact_email || '')}</p>
    <h3>${esc(doc.title || '')}</h3>
    <table><thead><tr><th>Produto/serviço</th><th class="n">Qtd.</th><th class="n">Valor unit.</th><th class="n">Desc.</th><th class="n">Total</th></tr></thead><tbody>
    ${items.map(i => `<tr><td>${esc(i.product_name || i.description || '')}</td><td class="n">${num(i.qty, 2)}</td><td class="n">${money(i.unit_price)}</td><td class="n">${num(i.discount, 2)}%</td><td class="n">${money(i.total)}</td></tr>`).join('')}
    </tbody></table><div class="tot">Subtotal: ${money(sub)}${doc.discount ? `<br>Desconto geral: ${num(doc.discount, 2)}%` : ''}<br><b>Total: ${money(doc.total)}</b></div>
    ${doc.notes ? `<h4>Condições</h4><p>${esc(doc.notes).replace(/\n/g, '<br>')}</p>` : ''}<p class="muted">${esc(tpl.footer || '')}</p>
    <p class="muted">Responsável: ${esc(doc.owner_name || '')}</p></body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 300); // sem <script> dentro da janela: compatível com a política de segurança (CSP)
}

// =================== PRODUTOS ===================
export async function productsPage(content) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || ''); const tab = qs.get('aba') || 'produtos';
  const p = page(content, 'Produtos', [
    maisAcoes([ehAdmin() ? { label: 'Novo grupo de produto', icon: '▦', click: () => optionQuick('product_group', 'Novo grupo') } : null,
      ehAdmin() ? { label: 'Nova família de produto', icon: '▦', click: () => optionQuick('product_family', 'Nova família') } : null]),
    h('button.btn.pri', { on: { click: () => productForm({}) } }, '+ Novo produto')],
  h('div.subtabs', [['produtos', 'Produtos'], ['grupos', 'Grupos'], ['familias', 'Famílias']].map(([k, l]) => h(`a${k === tab ? '.on' : ''}`, { href: `#/produtos?aba=${k}` }, l))));
  if (tab !== 'produtos') return p.append(optionsEditor(tab === 'grupos' ? 'product_group' : 'product_family'));
  await dataList(p, { module: 'products', entity: 'product', sort: 'product_name', searchPlaceholder: 'Nome ou código', searchKeys: ['product_name', 'product_code'],
    tabsDefault: [{ name: 'Todos', filter: '{}' }],
    columns: [['product_code', 'Código'], ['product_name', 'Nome'], ['product_group', 'Grupo'], ['product_family', 'Família'], ['product_price', 'Preço'], ['product_unit', 'Unid.']],
    onOpen: guard(async r => productForm(await api(`/t/products/${r.product_id}`))) });
}
export function productForm(x) {
  const f = form([{ key: 'name', label: 'Nome', required: true, span: 1 }, { key: 'code', label: 'Código' }, { key: 'price', label: 'Preço (R$)', type: 'money' },
    { key: 'group_id', label: 'Grupo', type: 'option:product_group' }, { key: 'family_id', label: 'Família', type: 'option:product_family' }, { key: 'unit', label: 'Unidade', default: 'un' },
    { key: 'description', label: 'Descrição', type: 'textarea', span: 1 }], x);
  const m = modal(x.id ? 'Editar produto' : 'Novo produto', f.el, { size: 'mid', foot: [
    x.id ? h('button.btn.danger', { style: { marginRight: 'auto' }, on: { click: guard(async () => { if (await confirmDialog('Excluir produto?')) { await del('products', x.id); m.close(); await loadMeta(); refresh('product'); } }) } }, 'Excluir') : null,
    h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => { await save('products', { ...f.value(), id: x.id }); m.close(); toast('Produto salvo'); await loadMeta(); refresh('product'); }) } }, 'Salvar')] });
}
async function optionQuick(kind, title) { const n = await promptDialog(title); if (!n) return; await save('options', { kind, name: n, ord: 99 }); await loadMeta(); refresh(); }

// =================== TAREFAS ===================
export async function tasksPage(content) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || ''); const view = qs.get('view') || 'lista';
  let pref = { status: 'open', mine: 'all' }; try { Object.assign(pref, JSON.parse(localStorage.getItem('lente-tasks') || '{}')); } catch {}
  const savePref = () => { try { localStorage.setItem('lente-tasks', JSON.stringify(pref)); } catch {} };
  const visao = h('div.seg', { role: 'group', 'aria-label': 'Visualização' },
    [['lista', 'ph:list Lista'], ['calendario', 'ph:calendar-blank Calendário'], ['tabela', 'ph:table Tabela']].map(([k, l]) => h(`a${view === k ? '.on' : ''}`, { href: `#/tarefas?view=${k}`, 'aria-current': view === k ? 'page' : null }, l)));
  const p = page(content, 'Tarefas', [visao,
    maisAcoes([ehAdmin() ? { label: 'Tipos de tarefa', icon: '⚙', click: () => go('#/administracao/opcoes') } : null]),
    h('button.btn.pri', { on: { click: () => taskForm({}) } }, '+ Nova tarefa')]);
  const filtros = h('div.row.wrap.filtros');
  const desenhaFiltros = () => clear(filtros).append(
    segmento('Situação', [['open', 'Abertas'], ['done', 'Finalizadas'], ['all', 'Todas']], pref.status, k => { pref.status = k; savePref(); desenhaFiltros(); draw(); }),
    segmento('Responsável', [['all', 'Equipe'], ['mine', 'Minhas'], ['others', 'De outros']], pref.mine, k => { pref.mine = k; savePref(); desenhaFiltros(); draw(); }));
  if (view !== 'tabela') { desenhaFiltros(); p.append(filtros); }
  if (view === 'tabela') {
    await dataList(p, { module: 'tasks', entity: 'task', sort: 'task_date', tabsDefault: [{ name: 'Abertas', filter: JSON.stringify({ conditions: [{ field: 'task_status', op: 1, value: ['Aberta'], group: 1 }] }) }, { name: 'Todas', filter: '{}' }],
      columns: [['task_title', 'Título'], ['task_date', 'Data'], ['task_time', 'Horário'], ['task_type', 'Tipo'], ['contact_name', 'Cliente'], ['deal_title', 'Negócio'], ['task_owner', 'Responsável'], ['task_status', 'Situação']],
      onOpen: guard(async r => taskForm(await api(`/t/tasks/${r.task_id}`))) });
    return;
  }
  const box = h('div'); p.append(box);
  let month = new Date(); month.setDate(1);
  async function draw() {
    let list = await api('/t/tasks');
    const ctx = Object.fromEntries((await rowsOf('task', true)).map(r => [r.task_id, r]));
    if (pref.status !== 'all') list = list.filter(t => (pref.status === 'done') === !!t.done);
    if (pref.mine === 'mine') list = list.filter(t => t.owner_id === state.me.id); else if (pref.mine === 'others') list = list.filter(t => t.owner_id !== state.me.id);
    clear(box);
    if (view === 'calendario') {
      const y = month.getFullYear(), mo = month.getMonth();
      const start = new Date(y, mo, 1 - new Date(y, mo, 1).getDay());
      const head = h('div.row', { style: { marginBottom: '10px' } }, h('button.iconbtn', { 'aria-label': 'Mês anterior', title: 'Mês anterior', on: { click: () => { month = new Date(y, mo - 1, 1); draw(); } } }, 'ph:caret-left'),
        h('button.btn.sm', { on: { click: () => { month = new Date(); month.setDate(1); draw(); } } }, 'Este mês'),
        h('button.iconbtn', { 'aria-label': 'Próximo mês', title: 'Próximo mês', on: { click: () => { month = new Date(y, mo + 1, 1); draw(); } } }, 'ph:caret-right'),
        h('h3', { style: { textTransform: 'capitalize' } }, month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })));
      const cal = h('div.cal', ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => h('div.dh', d)));
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dayTasks = list.filter(t => t.date === ds).sort((a, b) => String(a.time).localeCompare(String(b.time)));
        cal.append(h(`div.d${d.getMonth() !== mo ? '.out' : ''}${ds === today() ? '.today' : ''}`, { on: { dblclick: () => taskForm({ date: ds }) } }, h('span.n', d.getDate()),
          dayTasks.slice(0, 4).map(t => h(`span.ev${t.done ? '.done' : ''}`, { title: t.title, on: { click: () => taskForm(t) } }, `${t.time || ''} ${t.title}`)),
          dayTasks.length > 4 ? h('span.small.muted', `+${dayTasks.length - 4}`) : null));
      }
      box.append(head, cal, h('p.small.muted', 'Dica: clique duas vezes em um dia para agendar uma tarefa.'));
      return;
    }
    list.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (pref.status === 'done') list.reverse();
    if (!list.length) return box.append(h('div.tablewrap', h(`div.empty${pref.status === 'open' ? '.ok' : ''}`,
      pref.status === 'open' ? (pref.mine === 'mine' ? 'Nenhuma tarefa sua em aberto. Tudo em dia.' : 'Nenhuma tarefa em aberto na equipe. Tudo em dia.')
        : pref.status === 'done' ? 'Nenhuma tarefa finalizada com esse filtro.' : 'Nenhuma tarefa com esse filtro.',
      h('div.row', { style: { justifyContent: 'center', marginTop: '12px' } }, h('button.btn.sm', { on: { click: () => taskForm({}) } }, '+ Agendar tarefa'),
        pref.status === 'open' ? h('button.btn.sm.ghost', { on: { click: () => { pref.status = 'done'; savePref(); desenhaFiltros(); draw(); } } }, 'Ver finalizadas') : null))));
    const groups = {}; for (const t of list.slice(0, 300)) (groups[t.date < today() && !t.done ? 'Atrasadas' : t.date === today() ? 'Hoje' : date(t.date)] ||= []).push(t);
    for (const [g, ts] of Object.entries(groups)) box.append(h('h3.grupo', { style: { color: g === 'Atrasadas' ? 'var(--danger)' : '' } }, g, h('span.count', String(ts.length))),
      h('div.tablewrap', h('table.t', h('tbody', ts.map(t => h('tr', h('td', { style: { width: '30px' } }, h('input', { type: 'checkbox', checked: !!t.done, on: { change: guard(async e => { await save('tasks', { id: t.id, done: e.target.checked ? 1 : 0 }); invalidate('task'); toast(e.target.checked ? 'Tarefa finalizada' : 'Tarefa reaberta'); draw(); }) } })),
        h('td', { style: { cursor: 'pointer' }, on: { click: () => taskForm(t) } }, h('b', t.title), h('div.small.muted', [ctx[t.id]?.task_type, ctx[t.id]?.contact_name, ctx[t.id]?.deal_title].filter(Boolean).join(' · '))),
        h('td.nw', g === 'Atrasadas' || pref.status !== 'open' ? h('span', date(t.date), t.time ? h('span.hora', t.time) : null) : (t.time || h('span.vazio', 'sem horário'))),
        h('td.nw', ctx[t.id]?.task_owner ? h('span.who', h('span.avatar.xs', initials(ctx[t.id].task_owner)), ctx[t.id].task_owner) : '')))))));
  }
  draw();
}
export function taskForm(t) {
  const f = form([{ key: 'title', label: 'Título', required: true, max: 100, span: 1 }, { key: 'type_id', label: 'Tipo', type: 'option:task_type' },
    { key: 'owner_id', label: 'Responsável', type: 'user', required: true }, { key: 'date', label: 'Data', type: 'date', default: today(), required: true }, { key: 'time', label: 'Horário', type: 'time' },
    { key: 'duration', label: 'Duração (min)', type: 'number', default: 30 }, { key: 'reminder', label: 'Lembrete', type: 'select', options: ['Sem lembrete', 'No horário', '30 minutos antes', '1 hora antes', '1 dia antes', '1 semana antes'].map(x => ({ id: x, name: x })) },
    { key: 'repeat_days', label: 'Repetir a cada (dias)', type: 'number' }, { key: 'contact_id', label: 'Cliente', type: 'contact' }, { key: 'deal_id', label: 'Negócio', type: 'deal' },
    { key: 'address', label: 'Endereço', max: 200 }, { key: 'description', label: 'Descrição', type: 'textarea', span: 1 }], t);
  const m = modal(t.id ? 'Editar tarefa' : 'Agendar tarefa', f.el, { size: 'mid', foot: [
    t.id ? h('button.btn.danger', { style: { marginRight: 'auto' }, on: { click: guard(async () => { if (await confirmDialog('Excluir tarefa?')) { await del('tasks', t.id); m.close(); refresh('task'); } }) } }, 'Excluir') : null,
    t.id ? h('button.btn', { on: { click: guard(async () => { await save('tasks', { id: t.id, done: t.done ? 0 : 1 }); m.close(); toast(t.done ? 'Tarefa reaberta' : 'Tarefa finalizada'); refresh('task'); }) } }, t.done ? 'Reabrir' : '✓ Finalizar') : null,
    h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'),
    h('button.btn.pri', { on: { click: guard(async () => { const v = f.value(); await save('tasks', { ...v, id: t.id });
      if (!t.id && v.repeat_days > 0) for (let i = 1; i <= 5; i++) { const d = new Date(`${v.date}T12:00`); d.setDate(d.getDate() + v.repeat_days * i); await save('tasks', { ...v, date: d.toISOString().slice(0, 10) }); }
      m.close(); toast('Tarefa salva'); refresh('task'); }) } }, 'Salvar')] });
}

// =================== INTERAÇÕES ===================
export async function interactionsPage(content) {
  const p = page(content, 'Interações', [maisAcoes([ehAdmin() ? { label: 'Tipos de interação', icon: '⚙', click: () => go('#/administracao/opcoes') } : null]),
    h('button.btn.pri', { on: { click: () => interactionForm({}) } }, '+ Registrar interação')]);
  await dataList(p, { module: 'interactions', entity: 'interaction', sort: 'interaction_date', tabsDefault: [{ name: 'Todas', filter: '{}' }], searchPlaceholder: 'Cliente, negócio ou descrição', searchKeys: ['contact_name', 'deal_title', 'interaction_description'],
    columns: [['interaction_date', 'Data'], ['contact_name', 'Cliente'], ['interaction_type', 'Tipo'], ['interaction_owner', 'Responsável'], ['deal_title', 'Negócio'], ['interaction_description', 'Descrição', 'text']],
    onOpen: guard(async r => interactionForm(await api(`/t/interactions/${r.interaction_id}`))) });
}
export function interactionForm(x) {
  const now = new Date(); const def = `${today()}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const f = form([{ key: 'contact_id', label: 'Cliente', type: 'contact' }, { key: 'deal_id', label: 'Negócio', type: 'deal' }, { key: 'type_id', label: 'Tipo', type: 'option:interaction_type' },
    { key: 'owner_id', label: 'Responsável', type: 'user', required: true }, { key: 'description', label: 'Descrição', type: 'textarea', span: 1, required: true }], x);
  const when = h('input.i', { type: 'datetime-local', value: x.date ? String(x.date).replace(' ', 'T').slice(0, 16) : def });
  f.el.prepend(field('Data e hora', when));
  const m = modal(x.id ? 'Editar registro' : 'Novo registro de interação', f.el, { size: 'mid', foot: [
    x.id ? h('button.btn.danger', { style: { marginRight: 'auto' }, on: { click: guard(async () => { if (await confirmDialog('Excluir registro?')) { await del('interactions', x.id); m.close(); refresh('interaction'); } }) } }, 'Excluir') : null,
    h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => { await save('interactions', { ...f.value(), id: x.id, date: when.value.replace('T', ' ') + ':00' }); m.close(); toast('Interação registrada'); refresh('interaction', 'contact'); }) } }, 'Salvar')] });
}

// =================== USUÁRIOS ===================
export async function usersPage(content) {
  await loadMeta();
  const p = page(content, 'Usuários', [maisAcoes([{ label: 'Equipes', icon: 'ph:users-three', click: () => go('#/administracao/equipes') }]), h('button.btn.pri', { on: { click: () => userForm({}) } }, '+ Novo usuário')]);
  p.append(h('div.tablewrap', h('table.t', h('thead', h('tr', ['', 'Nome', 'E-mail', 'Cargo', 'Perfil', 'Equipe', 'Situação'].map(x => h('th', x)))),
    h('tbody', state.meta.users.map(u => h('tr.click', { on: { click: () => userForm(u) } }, h('td', h('span.avatar', initials(u.name))), h('td', u.name), h('td', u.email), h('td', u.title || h('span.vazio', '—')), h('td.nw', u.role === 'Administrador' ? h('span.badge.open', 'ph:lock-key Administrador') : u.role),
      h('td', state.meta.teams.find(t => t.id === u.team_id)?.name || ''), h('td', u.active ? h('span.badge.won', 'Ativo') : h('span.badge.lost', 'Suspenso'))))))));
}
function userForm(u) {
  const f = form([{ key: 'name', label: 'Nome', required: true, max: 100 }, { key: 'email', label: 'E-mail', type: 'email', required: true },
    { key: 'role', label: 'Perfil', type: 'select', required: true, options: ['Administrador', 'Gestor', 'Usuário'].map(x => ({ id: x, name: x })) }, { key: 'title', label: 'Cargo' },
    { key: 'phone', label: 'Telefone' }, { key: 'team_id', label: 'Equipe', type: 'team' },
    { key: 'active', label: 'Situação', type: 'select', required: true, options: [{ id: 1, name: 'Ativo' }, { id: 0, name: 'Suspenso' }] }, { key: 'password', label: u.id ? 'Nova senha (opcional, mínimo de 8)' : 'Senha (mínimo de 8 caracteres)', required: !u.id }], { active: 1, role: 'Usuário', ...u, password: '' });
  const m = modal(u.id ? 'Editar usuário' : 'Novo usuário', f.el, { size: 'mid', foot: [h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'),
    h('button.btn.pri', { on: { click: guard(async () => { const v = f.value(); if (!v.password) delete v.password; await save('users', { ...v, id: u.id }); m.close(); toast('Usuário salvo'); await loadMeta(); refresh('user'); }) } }, 'Salvar')] });
}

// =================== ADMINISTRAÇÃO ===================
const OPTION_KINDS = [['segment', 'Segmentos de cliente'], ['origin', 'Origens'], ['contact_status', 'Status de cliente'], ['loss_reason', 'Motivos de perda'],
  ['task_type', 'Tipos de tarefa'], ['interaction_type', 'Tipos de interação'], ['product_group', 'Grupos de produto'], ['product_family', 'Famílias de produto'], ['order_stage', 'Estágios da venda'], ['tag', 'Marcadores']];
function optionsEditor(kind) {
  const box = h('div');
  const draw = async () => {
    await loadMeta(); const list = opts(kind); clear(box);
    box.append(h('div.tablewrap', h('table.t', h('tbody', list.map((o, i) => h('tr', h('td', h('input.i', { value: o.name, on: { change: guard(async e => { await save('options', { id: o.id, name: e.target.value }); toast('Salvo'); invalidate(); }) } })),
      h('td.nw', { style: { width: '96px', textAlign: 'right' } }, h('button.iconbtn', { title: 'Subir', 'aria-label': `Subir ${o.name}`, disabled: !i, on: { click: guard(async () => { await save('options', { id: o.id, ord: i - 1 }); await save('options', { id: list[i - 1].id, ord: i }); draw(); }) } }, 'ph:arrow-up'),
        h('button.iconbtn', { title: 'Excluir', 'aria-label': `Excluir ${o.name}`, on: { click: guard(async () => { if (await confirmDialog(`Excluir "${o.name}"? Registros que usam essa opção ficam sem ela.`, 'Excluir')) { await del('options', o.id); invalidate(); draw(); } }) } }, 'ph:trash'))))))),
    h('button.btn.sm', { style: { marginTop: '8px' }, on: { click: guard(async () => { const n = await promptDialog('Nome da nova opção'); if (n) { await save('options', { kind, name: n, ord: list.length }); draw(); } }) } }, '+ Adicionar opção'));
  };
  draw(); return box;
}
export async function adminPage(content, section) {
  const SECTIONS = [
    ['Geral', [['empresa', '🏢', 'Dados da empresa'], ['config', '⚙', 'Configurações do sistema'], ['opcoes', '☰', 'Opções pré-cadastradas'], ['automacoes', '🤖', 'Automações']]],
    ['Usuários', [['usuarios', '👥', 'Tabela de usuários'], ['equipes', '👪', 'Equipes de usuários'], ['registros', '📜', 'Histórico de atividades']]],
    ['Vendas', [['funis', '$', 'Funis e estágios'], ['modelo', '▤', 'Modelo de documento']]],
    ['Dados', [['importar', '⇪', 'Importar clientes'], ['exportar', '⇩', 'Exportar dados (CSV)']]],
  ];
  if (!section) {
    const p = page(content, 'Administração');
    for (const [g, items] of SECTIONS) p.append(h('h3', { style: { margin: '16px 0 8px' } }, g), h('div.kpis', items.map(([k, ic, l]) => h('a.card.kpi', { href: k === 'usuarios' ? '#/usuarios' : k === 'funis' ? '#/funis' : `#/administracao/${k}`, style: { color: 'var(--fg)', textDecoration: 'none' } }, h('div', { style: { fontSize: '22px' } }, ic), h('b', l)))));
    return;
  }
  const title = SECTIONS.flatMap(s => s[1]).find(x => x[0] === section)?.[2] || 'Administração';
  const p = page(content, title, []);
  p.prepend(h('div.pagehead', h('a.back', { href: '#/administracao' }, 'ph:arrow-left Administração'), h('span.grow')));
  const settings = await api('/settings');
  if (section === 'empresa') {
    const f = form([{ key: 'name', label: 'Nome', required: true }, { key: 'email', label: 'E-mail' }, { key: 'phone', label: 'Telefone' }, { key: 'cnpj', label: 'CNPJ' },
      { key: 'address', label: 'Endereço' }, { key: 'city', label: 'Cidade' }, { key: 'site', label: 'Site' }], settings.company || {});
    p.append(h('div.card', h('div.bd', f.el, h('button.btn.pri', { style: { marginTop: '12px' }, on: { click: guard(async () => { await api('/settings/company', { method: 'PUT', body: f.value() }); toast('Dados salvos'); }) } }, 'Salvar'))));
  } else if (section === 'config') {
    const c = settings.system || {};
    const f = form([{ key: 'currency', label: 'Moeda', type: 'select', required: true, options: [{ id: 'BRL', name: 'Real (R$)' }, { id: 'USD', name: 'Dólar (US$)' }] },
      { key: 'timezone', label: 'Fuso horário', default: 'America/Sao_Paulo' }, { key: 'cache_minutes', label: 'Cache dos relatórios (min)', type: 'number', default: 10 }], c);
    p.append(h('div.card', h('div.bd', f.el, h('p.hint', { style: { marginTop: '12px' } }, 'ph:lock-key Senhas: mínimo de 8 caracteres e sem senhas comuns. Essa regra vale sempre, para todos os usuários.'), h('button.btn.pri', { style: { marginTop: '12px' }, on: { click: guard(async () => { await api('/settings/system', { method: 'PUT', body: f.value() }); toast('Configurações salvas'); }) } }, 'Salvar'))));
  } else if (section === 'opcoes') {
    await loadMeta();
    for (const [k, l] of OPTION_KINDS) { const n = opts(k).length;
      p.append(h('details.card.opt', h('summary', h('span', l), h('span.count', n ? `${n} ${n === 1 ? 'opção' : 'opções'}` : 'vazio')), h('div.bd', optionsEditor(k)))); }
  } else if (section === 'equipes') {
    const draw = async () => { await loadMeta(); clear(box); box.append(h('div.tablewrap', h('table.t', h('tbody', state.meta.teams.map(t => h('tr', h('td', h('input.i', { value: t.name, on: { change: guard(async e => { await save('teams', { id: t.id, name: e.target.value }); toast('Salvo'); }) } })),
      h('td.muted', `${state.meta.users.filter(u => u.team_id === t.id).length} usuários`), h('td', h('button.btn.sm.danger', { on: { click: guard(async () => { if (await confirmDialog('Excluir equipe?')) { await del('teams', t.id); draw(); } }) } }, '✕'))))))),
      h('button.btn', { style: { marginTop: '8px' }, on: { click: guard(async () => { const n = await promptDialog('Nova equipe'); if (n) { await save('teams', { name: n }); draw(); } }) } }, '+ Nova equipe')); };
    const box = h('div'); p.append(box); draw();
  } else if (section === 'registros') {
    const logs = await api('/t/logs'); let tipo = 'mudancas', q = '';
    const ACESSO = /^(login|logout|trocou a senha)$/;
    const busca = h('input.i', { type: 'search', placeholder: 'Usuário, ação ou detalhe', 'aria-label': 'Buscar nos registros', style: { maxWidth: '280px' }, on: { input: e => { q = e.target.value.toLowerCase(); desenha(); } } });
    const barra = h('div.row.wrap.filtros'), tabela = h('div');
    const desenhaBarra = () => clear(barra).append(segmento('Tipo de registro', [['mudancas', 'Alterações'], ['acessos', 'Acessos'], ['tudo', 'Tudo']], tipo, k => { tipo = k; desenhaBarra(); desenha(); }), busca,
      h('span.grow'), h('span.small.muted', 'Últimos 500 registros'));
    const CAMPO = { done: 'situação', done_at: null, id: null, updated_at: null, created_at: null, stage_id: 'estágio', status: 'situação', amount: 'valor', owner_id: 'responsável', title: 'título', name: 'nome',
      date: 'data', time: 'horário', contact_id: 'cliente', deal_id: 'negócio', description: 'descrição', password: 'senha', role: 'perfil', active: 'situação', email: 'e-mail', phone: 'telefone', type_id: 'tipo', qr: 'por QR code' };
    const detalhe = d => { if (!d) return ''; const partes = String(d).split(/,\s*/);
      if (!partes.every(x => /^[a-z_]+$/.test(x))) return d;
      const nomes = [...new Set(partes.map(x => x in CAMPO ? CAMPO[x] : x.replace(/_id$/, '').replace(/_/g, ' ')).filter(Boolean))];
      return nomes.length ? (partes.length === 1 && partes[0] === 'qr' ? nomes[0] : `campos: ${nomes.join(', ')}`) : ''; };
    const nomeDe = id => state.meta.users.find(u => u.id === id)?.name || 'Sistema';
    function desenha() {
      const lista = logs.filter(l => (tipo === 'tudo' || (tipo === 'acessos') === ACESSO.test(l.action)) && (!q || `${nomeDe(l.user_id)} ${l.action} ${l.detail || ''} ${labelTable(l.entity)}`.toLowerCase().includes(q)));
      clear(tabela).append(h('div.tablewrap', lista.length ? h('table.t', h('thead', h('tr', ['Quando', 'Usuário', 'O que fez', 'Detalhe'].map(x => h('th', x)))),
        h('tbody', lista.map(l => h('tr', h('td.nw', h('span', { title: dateTime(l.at) }, date(l.at)), h('span.hora', String(l.at || '').slice(11, 16))),
          h('td.nw', h('span.who', h('span.avatar.xs', initials(nomeDe(l.user_id))), nomeDe(l.user_id))),
          h('td', `${l.action}${l.entity && !ACESSO.test(l.action) && !l.action.toLowerCase().includes(String(labelTable(l.entity)).toLowerCase()) ? ` ${labelTable(l.entity)}` : ''}${l.item_id && !ACESSO.test(l.action) ? ` nº ${l.item_id}` : ''}`),
          h('td', h('div.cl', { title: l.detail || null }, detalhe(l.detail) || h('span.vazio', '—'))))))) : h('div.empty', 'Nenhum registro com esse filtro.')));
    }
    desenhaBarra(); p.append(barra, tabela); desenha();
  } else if (section === 'automacoes') {
    const box = h('div'); p.append(h('p.muted', 'Crie regras que geram tarefas automaticamente quando algo acontece com um negócio ou cliente.'), box);
    const triggers = { created: 'For criado', stage: 'Entrar no estágio', won: 'For ganho', lost: 'For perdido' };
    const draw = async () => {
      const list = await api('/t/automations'); clear(box);
      box.append(list.length ? h('div.tablewrap', h('table.t', h('thead', h('tr', ['Nome', 'Entidade', 'Quando', 'Ação', 'Ativa', ''].map(x => h('th', x)))), h('tbody', list.map(a => h('tr',
        h('td', a.name), h('td', a.entity === 'deal' ? 'Negócio' : 'Cliente'), h('td', `${triggers[a.trigger]}${a.trigger === 'stage' ? ': ' + (state.meta.pipelines.flatMap(p => p.stages).find(s => s.id === +a.trigger_value)?.name || '') : ''}`),
        h('td', `Criar tarefa "${JSON.parse(a.action_value || '{}').title || ''}" em ${JSON.parse(a.action_value || '{}').days || 1} dia(s)`),
        h('td', h('input', { type: 'checkbox', checked: !!a.active, on: { change: guard(async e => { await save('automations', { id: a.id, active: e.target.checked ? 1 : 0 }); }) } })),
        h('td', h('button.btn.sm.danger', { on: { click: guard(async () => { await del('automations', a.id); draw(); }) } }, '✕'))))))) : h('div.empty', 'Nenhuma automação'),
      h('button.btn.pri', { style: { marginTop: '10px' }, on: { click: () => {
        const name = h('input.i'); const ent = sel([{ id: 'deal', name: 'Negócio' }, { id: 'contact', name: 'Cliente' }], 'deal', { empty: null });
        const trig = sel(Object.entries(triggers).map(([id, name]) => ({ id, name })), 'stage', { empty: null });
        const stage = sel(state.meta.pipelines.flatMap(p => p.stages.map(s => ({ id: s.id, name: `${p.name} › ${s.name}` }))), '', { empty: '—' });
        const title = h('input.i', { placeholder: 'Ex.: Ligar para confirmar recebimento da proposta' }); const days = h('input.i', { type: 'number', value: 1 });
        const m = modal('Nova automação', h('div.grid2', field('Nome', name), field('Entidade', ent), field('Quando', trig), field('Estágio (se aplicável)', stage), field('Título da tarefa', title), field('Prazo (dias)', days)), { size: 'mid', foot: [
          h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => { if (!name.value) throw new Error('Informe o nome');
            await save('automations', { name: name.value, entity: ent.value, trigger: trig.value, trigger_value: stage.value || null, action: 'create_task', action_value: JSON.stringify({ title: title.value || name.value, days: +days.value || 1 }), active: 1 }); m.close(); draw(); }) } }, 'Salvar')] });
      } } }, '+ Nova automação'));
    };
    draw();
  } else if (section === 'modelo') {
    const t = settings.doc_template || {};
    const head = h('textarea.i', { value: t.header || 'Agradecemos a oportunidade. Segue nossa proposta conforme conversado.' });
    const foot = h('textarea.i', { value: t.footer || 'Validade da proposta: 15 dias. Pagamento conforme condições acordadas.' });
    p.append(h('div.card', h('div.bd.col', field('Texto de abertura (impressão de propostas, vendas e documentos)', head), field('Rodapé / condições gerais', foot),
      h('div', h('button.btn.pri', { on: { click: guard(async () => { await api('/settings/doc_template', { method: 'PUT', body: { header: head.value, footer: foot.value } }); toast('Modelo salvo'); }) } }, 'Salvar')))));
  } else if (section === 'importar') {
    p.append(h('div.card', h('div.bd', h('p', 'Importe clientes a partir de um arquivo CSV.'), h('button.btn.pri', { on: { click: importContacts } }, 'Importar clientes'))));
  } else if (section === 'exportar') {
    p.append(h('div.kpis', Object.values(ENTITIES).map(e => h('button.card.kpi', { style: { cursor: 'pointer', textAlign: 'left' }, on: { click: guard(async () => {
      const rs = await rowsOf(e.key, true);
      const csv = csvLinhas([e.fields.map(f => f[1]), ...rs.map(r => e.fields.map(([k]) => r[k] ?? ''))]);
      download(`${e.key}.csv`, '﻿' + csv, 'text/csv');
    }) } }, h('b', e.label), h('div.small.muted', 'Baixar CSV')))));
  }
}
