// Banco SQLite (node:sqlite) — esquema e dados de demonstração.
import { DatabaseSync } from 'node:sqlite';
import { CLIENTES, TITULOS, PRODUTOS, GRUPOS, FAMILIAS, SEGMENTOS, EMPRESA, NOTAS, dominio, segmentoDe } from './seed-data.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.CRM_DB ? path.resolve(process.env.CRM_DB) : path.join(DIR, 'data', 'lente.db');

// Usado só na criação dos dados de demonstração; no dia a dia o servidor usa seguranca.js (assíncrono).
export const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
export const checkHash = (pw, stored) => {
  const [salt] = String(stored).split(':');
  return hash(pw, salt) === stored;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, password TEXT,
  role TEXT DEFAULT 'Usuário', title TEXT, phone TEXT, team_id INTEGER, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS options (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, ord INTEGER DEFAULT 0, color TEXT);
CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY, type TEXT DEFAULT 'company', name TEXT NOT NULL, legal_name TEXT, doc TEXT,
  segment_id INTEGER, origin_id INTEGER, status_id INTEGER, owner_id INTEGER, company_id INTEGER, email TEXT, phone TEXT, role_title TEXT,
  city TEXT, state TEXT, address TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), last_contact_at TEXT);
CREATE TABLE IF NOT EXISTS pipelines (id INTEGER PRIMARY KEY, name TEXT NOT NULL, archived INTEGER DEFAULT 0, favorite INTEGER DEFAULT 0, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS stages (id INTEGER PRIMARY KEY, pipeline_id INTEGER NOT NULL, name TEXT NOT NULL, ord INTEGER DEFAULT 0, checklist TEXT);
CREATE TABLE IF NOT EXISTS deals (id INTEGER PRIMARY KEY, title TEXT NOT NULL, contact_id INTEGER, pipeline_id INTEGER, stage_id INTEGER, owner_id INTEGER,
  amount REAL DEFAULT 0, status TEXT DEFAULT 'open', loss_reason_id INTEGER, origin_id INTEGER, start_date TEXT, end_date TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), stage_changed_at TEXT DEFAULT (datetime('now','localtime')), closed_at TEXT);
CREATE TABLE IF NOT EXISTS deal_history (id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL, stage_id INTEGER NOT NULL, entered_at TEXT, left_at TEXT);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT, group_id INTEGER, family_id INTEGER, price REAL DEFAULT 0,
  unit TEXT DEFAULT 'un', description TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, number INTEGER, revision INTEGER DEFAULT 1, title TEXT, deal_id INTEGER, contact_id INTEGER,
  owner_id INTEGER, date TEXT, status TEXT DEFAULT 'open', stage_id INTEGER, discount REAL DEFAULT 0, total REAL DEFAULT 0, notes TEXT, template TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS doc_items (id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, product_id INTEGER, description TEXT, qty REAL DEFAULT 1,
  unit_price REAL DEFAULT 0, discount REAL DEFAULT 0, total REAL DEFAULT 0, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, date TEXT, time TEXT, duration INTEGER DEFAULT 30,
  type_id INTEGER, contact_id INTEGER, deal_id INTEGER, owner_id INTEGER, done INTEGER DEFAULT 0, done_at TEXT, reminder TEXT, repeat_days INTEGER,
  address TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS interactions (id INTEGER PRIMARY KEY, contact_id INTEGER, deal_id INTEGER, date TEXT, type_id INTEGER, description TEXT,
  owner_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS goal_panels (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY, panel_id INTEGER, name TEXT NOT NULL, entity TEXT, aggregator TEXT, field TEXT, date_field TEXT,
  user_id INTEGER, team_id INTEGER, target REAL, start_date TEXT, end_date TEXT, interval TEXT DEFAULT 'month', color TEXT, percent_only INTEGER DEFAULT 0, filter TEXT);
CREATE TABLE IF NOT EXISTS report_panels (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, ord INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS charts (id INTEGER PRIMARY KEY, panel_id INTEGER NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
  w INTEGER DEFAULT 6, h INTEGER DEFAULT 8, ord INTEGER DEFAULT 0, metric_limit INTEGER DEFAULT 10, order_asc INTEGER DEFAULT 0,
  pipeline_id INTEGER, history_months INTEGER DEFAULT 6, cache TEXT, cache_at TEXT);
CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY, chart_id INTEGER NOT NULL, entity TEXT NOT NULL, name TEXT, aggregator TEXT DEFAULT 'count',
  field TEXT, color TEXT, visible INTEGER DEFAULT 1, ord INTEGER DEFAULT 0, filter TEXT, dims TEXT);
CREATE TABLE IF NOT EXISTS panel_filters (id INTEGER PRIMARY KEY, panel_id INTEGER NOT NULL, type TEXT NOT NULL, name TEXT, ord INTEGER DEFAULT 0,
  value TEXT, active INTEGER DEFAULT 0, map TEXT);
CREATE TABLE IF NOT EXISTS tabs (id INTEGER PRIMARY KEY, module TEXT NOT NULL, name TEXT NOT NULL, filter TEXT, per_page INTEGER DEFAULT 25,
  ord INTEGER DEFAULT 0, visibility TEXT DEFAULT 'all');
CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, entity TEXT, item_id INTEGER, detail TEXT,
  at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS automations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, entity TEXT, trigger TEXT, trigger_value TEXT,
  action TEXT, action_value TEXT, active INTEGER DEFAULT 1);
`;

export function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF;');
  db.exec(SCHEMA);
  return db;
}

// ---------- dados de demonstração ----------
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const daysAgo = (n, h = int(8, 18)) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, int(0, 59), 0, 0); return d; };

export function seedDb(db) {
  const has = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (has) return false;
  const ins = (table, obj) => {
    const keys = Object.keys(obj);
    return Number(db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => obj[k])).lastInsertRowid);
  };
  db.exec('BEGIN');
  const teamA = ins('teams', { name: 'Comercial Interno' }), teamB = ins('teams', { name: 'Field Sales' });
  const users = [
    ['Administrador', 'admin@lente.local', 'Administrador', 'Diretor comercial', teamA],
    ['Marina Costa', 'marina@lente.local', 'Usuário', 'Executiva de vendas', teamA],
    ['Rafael Souza', 'rafael@lente.local', 'Usuário', 'Executivo de vendas', teamA],
    ['Juliana Alves', 'juliana@lente.local', 'Usuário', 'SDR', teamA],
    ['Bruno Lima', 'bruno@lente.local', 'Usuário', 'Representante', teamB],
    ['Camila Rocha', 'camila@lente.local', 'Usuário', 'Representante', teamB],
  ].map(([name, email, role, title, team_id], i) => ins('users', { name, email, role, title, team_id, password: hash(i === 0 ? 'admin123' : 'lente123'), created_at: fmt(daysAgo(400)) }));
  const seller = () => pick(users.slice(1));

  const opt = (kind, names) => names.map((name, i) => ins('options', { kind, name, ord: i }));
  const segments = opt('segment', SEGMENTOS);
  const origins = opt('origin', ['Indicação', 'Site', 'Google Ads', 'Feira/Evento', 'Prospecção ativa', 'Instagram', 'Parceiro']);
  const statuses = opt('contact_status', ['Ativo', 'Prospect', 'Inativo']);
  const lossReasons = opt('loss_reason', ['Preço', 'Escolheu concorrente', 'Sem orçamento', 'Projeto adiado', 'Sem retorno']);
  const taskTypes = opt('task_type', ['Ligação', 'Reunião', 'Visita', 'E-mail', 'WhatsApp']);
  const interTypes = opt('interaction_type', ['Ligação', 'Reunião', 'Visita', 'E-mail', 'WhatsApp']);
  const groups = opt('product_group', GRUPOS);
  const families = opt('product_family', FAMILIAS);
  const orderStages = opt('order_stage', ['Pedido recebido', 'Faturado', 'Em entrega', 'Entregue']);
  opt('tag', ['VIP', 'Recorrente', 'Prioridade', 'Inadimplente']);

  const cities = [['Salvador', 'BA'], ['Feira de Santana', 'BA'], ['São Paulo', 'SP'], ['Campinas', 'SP'], ['Rio de Janeiro', 'RJ'],
    ['Belo Horizonte', 'MG'], ['Recife', 'PE'], ['Fortaleza', 'CE'], ['Curitiba', 'PR'], ['Porto Alegre', 'RS'], ['Goiânia', 'GO'],
    ['Brasília', 'DF'], ['Aracaju', 'SE'], ['Vitória', 'ES'], ['Florianópolis', 'SC'], ['Manaus', 'AM'], ['Natal', 'RN'], ['João Pessoa', 'PB']];
  const first = ['Ana', 'Carlos', 'Fernanda', 'Lucas', 'Patrícia', 'Gustavo', 'Beatriz', 'Thiago', 'Larissa', 'Felipe', 'Renata', 'Diego', 'Aline', 'Marcelo'];
  const last = ['Santos', 'Oliveira', 'Pereira', 'Ferreira', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Barbosa', 'Araújo'];
  const companies = [];
  for (let i = 0; i < CLIENTES.length; i++) {
    const [name, city, state] = CLIENTES[i];
    const created = daysAgo(int(5, 420));
    companies.push(ins('contacts', {
      type: 'company', name, legal_name: `${name} Ltda`, doc: `${int(10, 99)}.${int(100, 999)}.${int(100, 999)}/0001-${int(10, 99)}`,
      segment_id: segments[segmentoDe(name)], origin_id: pick(origins), status_id: pick(statuses), owner_id: seller(), email: `contato@${dominio(name)}`,
      phone: `(${int(11, 99)}) 3${int(100, 999)}-${int(1000, 9999)}`, city, state, created_at: fmt(created), last_contact_at: fmt(daysAgo(int(0, 60))),
    }));
  }
  const persons = [];
  for (let i = 0; i < 70; i++) {
    const comp = pick(companies);
    const c = db.prepare('SELECT city,state,owner_id FROM contacts WHERE id=?').get(comp);
    const nm = `${pick(first)} ${pick(last)}`;
    persons.push(ins('contacts', {
      type: 'person', name: nm, company_id: rnd() < 0.85 ? comp : null, email: `${nm.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(' ', '.')}@${dominio(db.prepare('SELECT name FROM contacts WHERE id=?').get(comp).name)}`,
      phone: `(${int(11, 99)}) 9${int(1000, 9999)}-${int(1000, 9999)}`, role_title: pick(['Compras', 'Diretor', 'Gerente', 'Financeiro', 'Sócio']),
      city: c.city, state: c.state, owner_id: c.owner_id, origin_id: pick(origins), status_id: statuses[0], created_at: fmt(daysAgo(int(5, 400))),
    }));
  }

  // Funis
  const p1 = ins('pipelines', { name: 'Funil de Vendas', ord: 0, favorite: 1 });
  const p2 = ins('pipelines', { name: 'Pós-venda e Renovação', ord: 1 });
  const st1 = ['Pronto para abordagem', 'Tentando contato', 'Geração da cotação', 'Apresentação / Follow-up', 'Fechamento']
    .map((name, i) => ins('stages', { pipeline_id: p1, name, ord: i, checklist: JSON.stringify(i === 2 ? ['Levantar necessidades', 'Enviar proposta'] : []) }));
  const st2 = ['Onboarding', 'Acompanhamento', 'Renovação', 'Expansão'].map((name, i) => ins('stages', { pipeline_id: p2, name, ord: i }));

  // Produtos
  const prodDefs = PRODUTOS;
  const products = prodDefs.map(([name, code, g, f, price]) => ({ id: ins('products', { name, code, group_id: groups[g], family_id: families[f], price, created_at: fmt(daysAgo(int(200, 500))) }), price }));

  // Negócios com histórico de estágios
  let qn = 1000, on = 5000, dn = 100;
  for (let i = 0; i < 230; i++) {
    const pipeline = rnd() < 0.82 ? p1 : p2;
    const stages = pipeline === p1 ? st1 : st2;
    const contact = rnd() < 0.8 ? pick(companies) : pick(persons);
    const cname = db.prepare('SELECT name FROM contacts WHERE id=?').get(contact).name;
    const age = int(0, 360);
    const created = daysAgo(age);
    const owner = seller();
    const r = rnd();
    const status = age < 25 ? 'open' : r < 0.36 ? 'won' : r < 0.68 ? 'lost' : 'open';
    const maxStage = status === 'won' ? stages.length - 1 : status === 'lost' ? int(0, stages.length - 1) : Math.min(stages.length - 1, int(0, Math.floor(age / 12)));
    // percorre estágios
    let t = new Date(created);
    let hist = [];
    for (let s = 0; s <= maxStage; s++) {
      const enter = new Date(t);
      const stay = int(2, 14);
      t = new Date(t.getTime() + stay * 86400000);
      if (t > new Date()) t = new Date();
      hist.push({ stage: stages[s], enter, leave: s < maxStage ? new Date(t) : null });
    }
    const closed = status === 'open' ? null : fmt(t);
    const amount = Math.round((pick([1, 1, 2, 3, 5, 8]) * int(3, 30) * 1000) / 100) * 100;
    const deal = ins('deals', {
      title: pick(TITULOS), contact_id: contact, pipeline_id: pipeline, stage_id: stages[maxStage], owner_id: owner, amount,
      status, loss_reason_id: status === 'lost' ? pick(lossReasons) : null, origin_id: pick(origins), start_date: fmt(created).slice(0, 10),
      end_date: fmt(new Date(created.getTime() + int(20, 90) * 86400000)).slice(0, 10), created_at: fmt(created),
      stage_changed_at: fmt(hist[hist.length - 1].enter), closed_at: closed,
    });
    for (const h of hist) ins('deal_history', { deal_id: deal, stage_id: h.stage, entered_at: fmt(h.enter), left_at: h.leave ? fmt(h.leave) : closed });

    // Proposta(s)
    if (pipeline === p1 && maxStage >= 2) {
      const qdate = hist[2]?.enter || created;
      const nq = rnd() < 0.25 ? 2 : 1;
      for (let k = 0; k < nq; k++) {
        const qstatus = status === 'won' && k === nq - 1 ? 'won' : status === 'lost' || (status === 'won' && k < nq - 1) ? 'lost' : 'open';
        const q = ins('docs', { kind: 'quote', number: ++qn, revision: k + 1, title: `Proposta comercial — ${cname}`, deal_id: deal, contact_id: contact, owner_id: owner,
          date: fmt(new Date(qdate.getTime() + k * 4 * 86400000)), status: qstatus, template: 'Padrão', created_at: fmt(qdate) });
        let total = 0;
        for (let j = 0; j < int(1, 4); j++) {
          const p = pick(products); const qty = int(1, 6); const disc = pick([0, 0, 5, 10]);
          const tt = Math.round(p.price * qty * (1 - disc / 100) * 100) / 100; total += tt;
          ins('doc_items', { doc_id: q, product_id: p.id, qty, unit_price: p.price, discount: disc, total: tt, ord: j });
        }
        db.prepare('UPDATE docs SET total=? WHERE id=?').run(total, q);
        if (qstatus === 'won') {
          db.prepare('UPDATE deals SET amount=? WHERE id=?').run(total, deal);
          const o = ins('docs', { kind: 'order', number: ++on, title: `Pedido — ${cname}`, deal_id: deal, contact_id: contact, owner_id: owner, date: closed,
            status: 'won', stage_id: pick(orderStages), total, created_at: closed });
          for (const it of db.prepare('SELECT * FROM doc_items WHERE doc_id=?').all(q)) {
            ins('doc_items', { doc_id: o, product_id: it.product_id, qty: it.qty, unit_price: it.unit_price, discount: it.discount, total: it.total, ord: it.ord });
          }
          if (rnd() < 0.4) ins('docs', { kind: 'document', number: ++dn, title: `Contrato de prestação — ${cname}`, deal_id: deal, contact_id: contact, owner_id: owner, date: closed, status: 'open', total, created_at: closed });
        }
      }
    }
    // Tarefas e interações
    for (let j = 0; j < int(0, 3); j++) {
      const future = status === 'open' && rnd() < 0.5;
      const d = future ? daysAgo(-int(0, 20)) : daysAgo(int(0, age));
      ins('tasks', { title: `${pick(['Ligar para', 'Reunião com', 'Enviar material para', 'Visitar', 'Follow-up com'])} ${cname}`, date: fmt(d).slice(0, 10),
        time: `${pad(int(8, 17))}:${pick(['00', '30'])}`, type_id: pick(taskTypes), contact_id: contact, deal_id: deal, owner_id: owner,
        done: future ? 0 : 1, done_at: future ? null : fmt(d), created_at: fmt(daysAgo(age)) });
    }
    for (let j = 0; j < int(0, 4); j++) {
      const d = daysAgo(int(0, age));
      ins('interactions', { contact_id: contact, deal_id: deal, date: fmt(d), type_id: pick(interTypes), owner_id: owner,
        description: pick(NOTAS) });
    }
  }
  // tarefas de hoje
  for (let j = 0; j < 6; j++) ins('tasks', { title: `${pick(['Ligar para', 'Reunião com', 'Visitar'])} ${db.prepare('SELECT name FROM contacts WHERE id=?').get(pick(companies)).name}`,
    date: fmt(new Date()).slice(0, 10), time: `${pad(9 + j)}:00`, type_id: pick(taskTypes), owner_id: users[j % users.length], contact_id: pick(companies) });

  // Metas
  const gp = ins('goal_panels', { name: 'Metas comerciais' });
  const y = new Date().getFullYear();
  ins('goals', { panel_id: gp, name: 'Vendas do mês (R$)', entity: 'order', aggregator: 'sum', field: 'order_total', date_field: 'order_date', target: 250000, start_date: `${y}-01-01`, end_date: `${y}-12-31`, interval: 'month', color: '#fca311' });
  ins('goals', { panel_id: gp, name: 'Negócios ganhos no mês', entity: 'deal', aggregator: 'count', field: 'deal_id', date_field: 'deal_close_date', target: 12, start_date: `${y}-01-01`, end_date: `${y}-12-31`, interval: 'month', color: '#2563eb', filter: JSON.stringify({ conditions: [{ field: 'deal_status', op: 1, value: 'Ganho', group: 1 }] }) });
  ins('goals', { panel_id: gp, name: 'Interações da semana', entity: 'interaction', aggregator: 'count', field: 'interaction_id', date_field: 'interaction_date', target: 25, start_date: `${y}-01-01`, end_date: `${y}-12-31`, interval: 'week', color: '#d97706' });

  db.exec('COMMIT');
  seedReports(db, ins, p1);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('company', ?)").run(JSON.stringify(EMPRESA));
  return true;
}

// Painéis padrão de relatórios
function seedReports(db, ins, pipelineId) {
  db.exec('BEGIN');
  const rel = (id, n) => ({ rel: { id, n }, op: 1 });
  const cond = (field, extra) => ({ field, group: 1, ...extra });
  const panel = (name, ord) => ins('report_panels', { name, ord });
  let ord = 0;
  const chart = (panel_id, type, name, w, h, metrics, extra = {}) => {
    const c = ins('charts', { panel_id, type, name, w, h, ord: ord++, ...extra });
    metrics.forEach((m, i) => ins('metrics', { chart_id: c, entity: m.entity, name: m.name || name, aggregator: m.agg || 'count', field: m.field || null,
      color: m.color || ['#fca311', '#2563eb', '#d97706', '#db2777'][i], visible: 1, ord: i, filter: JSON.stringify({ conditions: m.filter || [] }), dims: JSON.stringify(m.dims || []) }));
    return c;
  };
  const pf = (panel_id, type, name, mapByEntity) => {
    const metrics = db.prepare('SELECT m.id, m.entity FROM metrics m JOIN charts c ON c.id=m.chart_id WHERE c.panel_id=?').all(panel_id);
    const map = {}; for (const m of metrics) if (mapByEntity[m.entity]) map[m.id] = mapByEntity[m.entity];
    ins('panel_filters', { panel_id, type, name, ord: 0, value: '{}', active: 0, map: JSON.stringify(map) });
  };
  const owner = { contact: 'contact_owner', deal: 'deal_owner', order: 'order_owner', order_item: 'order_owner', quote: 'quote_owner', interaction: 'interaction_owner', task: 'task_owner' };
  const date = { contact: 'contact_create_date', deal: 'deal_create_date', order: 'order_date', order_item: 'order_date', quote: 'quote_date', interaction: 'interaction_date', task: 'task_date' };

  const pv = panel('Vendas', 0);
  const s6 = [cond('order_date', rel('lastnmonths', 6))], sm = [cond('order_date', rel('thismonth'))];
  chart(pv, 'indicator', 'Nº de vendas neste mês', 4, 5, [{ entity: 'order', filter: sm }]);
  chart(pv, 'indicator', 'Valor em vendas neste mês', 4, 5, [{ entity: 'order', agg: 'sum', field: 'order_total', filter: sm }]);
  chart(pv, 'indicator', 'Ticket médio neste mês', 4, 5, [{ entity: 'order', agg: 'avg', field: 'order_total', filter: sm }]);
  chart(pv, 'area', 'Vendas realizadas nos últimos 6 meses', 12, 8, [{ entity: 'order', agg: 'sum', field: 'order_total', filter: s6, dims: [{ field: 'order_date', modifier: 'month' }] }]);
  chart(pv, 'table', 'Por vendedor — últimos 6 meses', 6, 8, [{ entity: 'order', agg: 'sum', field: 'order_total', name: 'Valor', filter: s6, dims: [{ field: 'order_owner' }] }, { entity: 'order', name: 'Quantidade', filter: s6, dims: [{ field: 'order_owner' }] }]);
  chart(pv, 'map', 'Por estado — últimos 6 meses', 6, 8, [{ entity: 'order', agg: 'sum', field: 'order_total', filter: s6, dims: [{ field: 'contact_state' }] }]);
  chart(pv, 'hbar', 'Por produto — últimos 6 meses', 6, 8, [{ entity: 'order_item', agg: 'sum', field: 'order_item_total', filter: s6, dims: [{ field: 'order_item_product' }] }]);
  chart(pv, 'donut', 'Por segmento — últimos 6 meses', 6, 8, [{ entity: 'order', agg: 'sum', field: 'order_total', filter: s6, dims: [{ field: 'contact_segment' }] }]);
  pf(pv, 'user', 'Usuário', owner); pf(pv, 'date', 'Data', date);

  const pn = panel('Negócios', 1);
  const dm = [cond('deal_create_date', rel('thismonth'))], d6 = [cond('deal_create_date', rel('lastnmonths', 6))];
  chart(pn, 'indicator', 'Negócios iniciados neste mês', 4, 5, [{ entity: 'deal', filter: dm }]);
  chart(pn, 'indicator', 'Valor médio dos negócios deste mês', 4, 5, [{ entity: 'deal', agg: 'avg', field: 'deal_amount', filter: dm }]);
  chart(pn, 'indicator', 'Valor em negócios iniciados neste mês', 4, 5, [{ entity: 'deal', agg: 'sum', field: 'deal_amount', filter: dm }]);
  chart(pn, 'bar', 'Negócios iniciados nos últimos 6 meses', 12, 8, [
    { entity: 'deal', name: 'Ganhos', filter: [...d6, cond('deal_status', { op: 1, value: 'Ganho' })], dims: [{ field: 'deal_create_date', modifier: 'month' }], color: '#16a34a' },
    { entity: 'deal', name: 'Perdidos', filter: [...d6, cond('deal_status', { op: 1, value: 'Perdido' })], dims: [{ field: 'deal_create_date', modifier: 'month' }], color: '#dc2626' },
    { entity: 'deal', name: 'Em andamento', filter: [...d6, cond('deal_status', { op: 1, value: 'Em andamento' })], dims: [{ field: 'deal_create_date', modifier: 'month' }], color: '#2563eb' }]);
  chart(pn, 'table', 'Por responsável e situação — últimos 6 meses', 6, 8, [{ entity: 'deal', filter: d6, dims: [{ field: 'deal_owner' }, { field: 'deal_status' }] }]);
  chart(pn, 'pie', 'Por origem — últimos 6 meses', 6, 8, [{ entity: 'deal', filter: d6, dims: [{ field: 'deal_origin' }] }]);
  pf(pn, 'user', 'Usuário', owner); pf(pn, 'date', 'Data', date);

  const pfun = panel('Funil de vendas', 2);
  chart(pfun, 'funnel_history', 'Análise histórica do funil (últimos 6 meses)', 12, 9, [], { pipeline_id: pipelineId, history_months: 6 });
  chart(pfun, 'funnel', 'Negócios em andamento por estágio', 6, 8, [{ entity: 'deal', filter: [cond('deal_status', { op: 1, value: 'Em andamento' }), cond('deal_pipeline', { op: 1, value: 'Funil de Vendas' })], dims: [{ field: 'deal_stage' }] }], { metric_limit: 0 });
  chart(pfun, 'pie', 'Motivos de perda — últimos 6 meses', 6, 8, [{ entity: 'deal', filter: [cond('deal_status', { op: 1, value: 'Perdido' }), ...d6], dims: [{ field: 'deal_loss_reason' }] }]);

  const pc = panel('Clientes', 3);
  chart(pc, 'area', 'Clientes cadastrados nos últimos 6 meses', 12, 7, [{ entity: 'contact', filter: [cond('contact_create_date', rel('lastnmonths', 6))], dims: [{ field: 'contact_create_date', modifier: 'month' }] }]);
  chart(pc, 'pie', 'Clientes por situação', 6, 8, [{ entity: 'contact', dims: [{ field: 'contact_status' }] }]);
  chart(pc, 'table', 'Segmentos dos clientes', 6, 8, [{ entity: 'contact', dims: [{ field: 'contact_segment' }] }]);
  chart(pc, 'map', 'Clientes por estado', 6, 8, [{ entity: 'contact', dims: [{ field: 'contact_state' }] }]);
  chart(pc, 'donut', 'Clientes por origem', 6, 8, [{ entity: 'contact', dims: [{ field: 'contact_origin' }] }]);
  pf(pc, 'user', 'Usuário', owner);

  const pi = panel('Interações', 4);
  chart(pi, 'line', 'Interações nos últimos 30 dias', 12, 7, [{ entity: 'interaction', filter: [cond('interaction_date', rel('last30days'))], dims: [{ field: 'interaction_date', modifier: 'day' }] }]);
  chart(pi, 'bar', 'Por dia da semana — últimos 60 dias', 6, 8, [{ entity: 'interaction', filter: [cond('interaction_date', rel('lastndays', 60))], dims: [{ field: 'interaction_date', modifier: 'weekday' }] }]);
  chart(pi, 'hbar', 'Por cidade — últimos 60 dias', 6, 8, [{ entity: 'interaction', filter: [cond('interaction_date', rel('lastndays', 60))], dims: [{ field: 'contact_city' }] }]);
  pf(pi, 'user', 'Usuário', owner); pf(pi, 'date', 'Data', date);

  const pq = panel('Propostas', 5);
  const q12 = [cond('quote_date', rel('lastnmonths', 12))];
  chart(pq, 'indicator', 'Propostas nos últimos 12 meses', 3, 5, [{ entity: 'quote', filter: q12 }]);
  chart(pq, 'indicator', 'Dessas, ganhas', 3, 5, [{ entity: 'quote', filter: [...q12, cond('quote_status', { op: 1, value: 'Ganha' })], color: '#16a34a' }]);
  chart(pq, 'indicator', 'Dessas, perdidas', 3, 5, [{ entity: 'quote', filter: [...q12, cond('quote_status', { op: 1, value: 'Perdida' })], color: '#dc2626' }]);
  chart(pq, 'indicator', 'Dessas, em aberto', 3, 5, [{ entity: 'quote', filter: [...q12, cond('quote_status', { op: 1, value: 'Em aberto' })], color: '#2563eb' }]);
  chart(pq, 'area', 'Propostas geradas nos últimos 12 meses', 12, 8, [{ entity: 'quote', filter: q12, dims: [{ field: 'quote_date', modifier: 'month' }] }]);
  pf(pq, 'user', 'Usuário', owner); pf(pq, 'date', 'Data', date);
  db.exec('COMMIT');
}

if (process.argv.includes('--reset')) {
  if (fs.existsSync(DB_PATH)) for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const db = openDb();
  seedDb(db);
  console.log('Banco recriado com dados de demonstração em', DB_PATH);
}
