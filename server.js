// Crmdss — servidor HTTP (sem dependências externas)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, seedDb } from './db.js';
import { limparDados } from './limpar.js';
import * as SEG from './seguranca.js';
const { falha, HttpError } = SEG;
import { ENTITIES, chartType } from './public/js/schema.js';
import { compute, drillRows, matchFilter, bucket, aggregate, ymd } from './public/js/engine.js';
import * as WA from './whatsapp.js';
import os from 'node:os';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(DIR, 'public');
const PORT = +process.env.PORT || 3090;
const HOST = process.env.HOST || '127.0.0.1';
const db = openDb();
if (seedDb(db)) {
  if (process.env.CRM_DEMO === '1') console.log('Banco criado com dados de demonstração.');
  else { limparDados(db); console.log('Banco novo criado, sem dados de exemplo. Entre com admin@lente.local / admin123 e crie sua senha.'); }
}

const all = (sql, ...a) => db.prepare(sql).all(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const now = () => { const d = new Date(); return `${ymd(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
const J = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const plain = o => (o ? { ...o } : o);

// ---------- CRUD genérico ----------
const TABLES = ['teams', 'users', 'options', 'contacts', 'pipelines', 'stages', 'deals', 'products', 'docs', 'tasks', 'interactions', 'goal_panels', 'goals', 'report_panels', 'tabs', 'automations', 'logs'];
const cols = {};
for (const t of [...TABLES, 'doc_items', 'panel_filters']) cols[t] = all(`PRAGMA table_info(${t})`).map(c => c.name).filter(c => c !== 'id');
const clean = (table, body) => {
  const o = {};
  for (const k of cols[table]) if (k in body) o[k] = body[k] === '' ? null : typeof body[k] === 'object' && body[k] !== null ? JSON.stringify(body[k]) : body[k];
  return o;
};
function insert(table, body) {
  const o = clean(table, body); const k = Object.keys(o);
  if (!k.length) return Number(run(`INSERT INTO ${table} DEFAULT VALUES`).lastInsertRowid);
  return Number(run(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map(x => o[x])).lastInsertRowid);
}
function update(table, id, body) {
  const o = clean(table, body); const k = Object.keys(o);
  if (k.length) run(`UPDATE ${table} SET ${k.map(x => `${x}=?`).join(',')} WHERE id=?`, ...k.map(x => o[x]), id);
}
const strip = r => { if (r && 'password' in r) delete r.password; return r; };
function log(user, action, entity, id, detail) { run('INSERT INTO logs (user_id,action,entity,item_id,detail,at) VALUES (?,?,?,?,?,?)', user?.id || null, action, entity, id || null, detail ? String(detail).slice(0, 500) : null, now()); }

WA.iniciarWhatsapp({ database: db, log: (...a) => log(...a), now });
for (const t of Object.keys(cols)) cols[t] = all(`PRAGMA table_info(${t})`).map(c => c.name).filter(c => c !== 'id');
const tipos = {}; for (const t of Object.keys(cols)) tipos[t] = Object.fromEntries(all(`PRAGMA table_info(${t})`).filter(c => c.name !== 'id').map(c => [c.name, String(c.type).toUpperCase()]));

// ---------- linhas planas por entidade (base de listas e relatórios) ----------
function rows(entity) { const e = ENTITIES[entity]; return e ? all(e.sql).map(plain) : []; }
function rowsFor(metrics) { const out = {}; for (const m of metrics) if (!out[m.entity]) out[m.entity] = rows(m.entity); return out; }

// ---------- relatórios ----------
const metricOut = m => ({ ...plain(m), filter: J(m.filter) || { conditions: [] }, dims: J(m.dims) || [], visible: !!m.visible });
function chartFull(id) {
  const c = plain(get('SELECT * FROM charts WHERE id=?', id));
  if (!c) return null;
  c.metrics = all('SELECT * FROM metrics WHERE chart_id=? ORDER BY ord,id', id).map(metricOut);
  delete c.cache;
  return c;
}
const filterOut = f => ({ ...plain(f), value: J(f.value) || {}, map: J(f.map) || {}, active: !!f.active });

function funnelHistory(pipelineId, months, panelFilters = []) {
  const stages = all('SELECT * FROM stages WHERE pipeline_id=? ORDER BY ord', pipelineId);
  const since = ymd(new Date(new Date().setMonth(new Date().getMonth() - (months || 6))));
  let deals = all(`SELECT d.*, u.name owner FROM deals d LEFT JOIN users u ON u.id=d.owner_id WHERE d.pipeline_id=? AND d.created_at>=?`, pipelineId, since);
  const userF = panelFilters.find(f => f.active && f.type === 'user' && f.value?.values?.length);
  if (userF) deals = deals.filter(d => userF.value.values.includes(d.owner));
  const ids = new Set(deals.map(d => d.id));
  const hist = all('SELECT * FROM deal_history').filter(h => ids.has(h.deal_id));
  const ordOf = Object.fromEntries(stages.map(s => [s.id, s.ord]));
  const maxOrd = {}; for (const h of hist) maxOrd[h.deal_id] = Math.max(maxOrd[h.deal_id] ?? -1, ordOf[h.stage_id] ?? -1);
  const out = stages.map((s, i) => {
    const reached = deals.filter(d => (maxOrd[d.id] ?? -1) >= s.ord).length;
    const hs = hist.filter(h => h.stage_id === s.id && h.left_at);
    const avgDays = hs.length ? hs.reduce((a, h) => a + (new Date(h.left_at) - new Date(h.entered_at)) / 86400000, 0) / hs.length : 0;
    const lost = deals.filter(d => d.status === 'lost' && (maxOrd[d.id] ?? -1) === s.ord).length;
    return { id: s.id, name: s.name, reached, avgDays: Math.round(avgDays * 10) / 10, lost };
  });
  out.forEach((s, i) => { s.conv = i < out.length - 1 && s.reached ? Math.round((out[i + 1].reached / s.reached) * 1000) / 10 : null; });
  const won = deals.filter(d => d.status === 'won').length;
  return { stages: out, total: deals.length, won, lost: deals.filter(d => d.status === 'lost').length, open: deals.filter(d => d.status === 'open').length,
    winRate: deals.length ? Math.round((won / deals.length) * 1000) / 10 : 0, wonAmount: deals.filter(d => d.status === 'won').reduce((a, d) => a + d.amount, 0) };
}

function calcChart(chart, panelFilters) {
  if (chart.type === 'funnel_history') return { type: 'funnel_history', funnel: funnelHistory(chart.pipeline_id, chart.history_months, panelFilters) };
  return compute(chart, chart.metrics, rowsFor(chart.metrics), panelFilters);
}

// ---------- metas ----------
function intervalRange(interval, offset = 0) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const span = { month: 1, bimester: 2, quarter: 3, quadrimester: 4, semester: 6, year: 12 }[interval];
  if (interval === 'day') { const d = new Date(t); d.setDate(d.getDate() + offset); return [ymd(d), ymd(d)]; }
  if (interval === 'week') { const s = new Date(t); s.setDate(s.getDate() - s.getDay() + 7 * offset); const e = new Date(s); e.setDate(e.getDate() + 6); return [ymd(s), ymd(e)]; }
  const s = new Date(t.getFullYear(), Math.floor(t.getMonth() / span) * span + offset * span, 1);
  const e = new Date(s.getFullYear(), s.getMonth() + span, 0);
  return [ymd(s), ymd(e)];
}
function goalProgress(g, offset = 0) {
  const ent = ENTITIES[g.entity]; if (!ent) return { value: 0 };
  const [a, b] = intervalRange(g.interval || 'month', offset);
  let rs = rows(g.entity).filter(r => { const d = String(r[g.date_field] || '').slice(0, 10); return d >= a && d <= b; });
  const f = J(g.filter); if (f) rs = rs.filter(r => matchFilter(r, f, ent.fieldMap));
  if (g.user_id) { const u = get('SELECT name FROM users WHERE id=?', g.user_id); rs = rs.filter(r => r[ent.ownerField] === u?.name); }
  if (g.team_id) { const t = get('SELECT name FROM teams WHERE id=?', g.team_id); const tf = Object.keys(ent.fieldMap).find(k => ent.fieldMap[k].type === 'team'); if (tf) rs = rs.filter(r => r[tf] === t?.name); }
  const value = aggregate(rs.map(r => (g.aggregator === 'count' ? r[ent.idField] : r[g.field])), g.aggregator);
  return { from: a, to: b, value, pct: g.target ? Math.round((value / g.target) * 1000) / 10 : 0 };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
const send = (res, code, data) => { res._dados = data; res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const LIMITE_CORPO = 5e6;
const body = (req, aceitaForm) => new Promise((ok, fail) => {
  let b = '', grande = false;
  req.on('data', c => { if (grande) return; b += c; if (b.length > LIMITE_CORPO) { grande = true; fail(new HttpError(413, 'Conteúdo grande demais.')); } });
  req.on('error', fail);
  req.on('end', () => {
    if (grande) return; if (!b) return ok({});
    const ct = String(req.headers['content-type'] || '');
    if (/urlencoded/.test(ct)) return aceitaForm ? ok(Object.fromEntries(new URLSearchParams(b))) : fail(new HttpError(415, 'Envie os dados em JSON.'));
    if (!/json/.test(ct) && !aceitaForm) return fail(new HttpError(415, 'Envie os dados em JSON.'));
    try { ok(JSON.parse(b)); } catch { fail(new HttpError(400, 'JSON inválido.')); }
  });
});
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]));

const routes = [];
const route = (method, pattern, fn, o = {}) => { if (o === true) o = { open: true };
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn, open: !!o.open, publica: !!o.publica, papel: o.papel || null, livreTroca: !!o.livreTroca }); };
const HTTPS = req => process.env.CRM_HTTPS === '1' || req.headers['x-forwarded-proto'] === 'https';

// ---------- autenticação ----------
let demoCache = null;
async function senhaPadraoAtiva() {
  if (demoCache && Date.now() - demoCache.at < 60e3) return demoCache.v;
  const u = get("SELECT password FROM users WHERE lower(email)='admin@lente.local' AND active=1");
  const v = !!u && await SEG.confereSenha('admin123', u.password); demoCache = { v, at: Date.now() }; return v;
}
route('GET', '/api/login-info', async (req, res) => send(res, 200, { demo: await senhaPadraoAtiva() }), { open: true, livreTroca: true });
route('POST', '/api/login', async (req, res, p, b) => {
  const ip = SEG.ipDe(req); const email = String(b.email || '').trim().toLowerCase().slice(0, 200); const senha = String(b.password || '').slice(0, 200);
  const min = SEG.minutosBloqueado(ip, email);
  if (min) falha(429, `Muitas tentativas erradas. Tente de novo em ${min} min.`);
  const u = get('SELECT * FROM users WHERE lower(email)=? AND active=1', email);
  const ok = await SEG.confereSenha(senha, u?.password); // roda mesmo sem usuário: tempo igual
  if (!u || !ok) { SEG.registraFalha(ip, email); falha(401, 'E-mail ou senha inválidos'); }
  SEG.registraAcerto(ip, email);
  if (SEG.hashAntigo(u.password)) run('UPDATE users SET password=? WHERE id=?', await SEG.hashSenha(senha), u.id); // reforça hash antigo
  const trocar = SEG.senhaFraca(senha);
  res.setHeader('Set-Cookie', SEG.cookieSessao(SEG.novaSessao(u.id, trocar), HTTPS(req)));
  log(u, 'login', 'users', u.id);
  send(res, 200, { ...strip(plain(u)), trocar_senha: trocar });
}, { open: true, livreTroca: true });
route('POST', '/api/logout', (req, res, p, b, user, ctx) => { SEG.encerraSessao(ctx.token); res.setHeader('Set-Cookie', SEG.cookieApaga(HTTPS(req))); send(res, 200, { ok: true }); }, { open: true, livreTroca: true });
route('GET', '/api/me', (req, res, p, b, user, ctx) => send(res, 200, { ...user, trocar_senha: !!ctx.sess?.trocar }), { livreTroca: true });
route('PUT', '/api/me/senha', async (req, res, p, b, user, ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', user.id);
  if (!ctx.sess.trocar && !(await SEG.confereSenha(String(b.atual || ''), u.password))) falha(400, 'A senha atual não confere.');
  const nova = SEG.validaSenhaNova(b.nova, u.email);
  if (await SEG.confereSenha(nova, u.password)) falha(400, 'A nova senha precisa ser diferente da atual.');
  run('UPDATE users SET password=? WHERE id=?', await SEG.hashSenha(nova), u.id);
  SEG.encerraSessoesDo(u.id, ctx.token); ctx.sess.trocar = false; demoCache = null;
  log(user, 'trocou a senha', 'users', u.id); send(res, 200, { ok: true });
}, { livreTroca: true });

route('GET', '/api/meta', (req, res) => {
  const options = {}; for (const o of all('SELECT * FROM options ORDER BY kind,ord,name')) (options[o.kind] ||= []).push(plain(o));
  const stages = all('SELECT * FROM stages ORDER BY pipeline_id,ord').map(plain);
  send(res, 200, {
    users: all('SELECT id,name,email,role,title,phone,team_id,active,created_at FROM users ORDER BY name').map(plain),
    teams: all('SELECT * FROM teams ORDER BY name').map(plain), options,
    pipelines: all('SELECT * FROM pipelines ORDER BY ord,id').map(p => ({ ...plain(p), stages: stages.filter(s => s.pipeline_id === p.id) })),
    products: all('SELECT id,name,code,price,unit FROM products WHERE active=1 ORDER BY name').map(plain),
    company: J(get("SELECT value FROM settings WHERE key='company'")?.value) || {},
  });
});

route('GET', '/api/rows/:entity', (req, res, p) => ENTITIES[p.entity] ? send(res, 200, rows(p.entity)) : send(res, 404, { error: 'entidade' }));

// CRUD
const podeLer = (user, t) => !SEG.LEITURA[t] || SEG.temPapel(user, SEG.LEITURA[t]);
const exigeEscrita = (user, t) => { const p = SEG.ESCRITA[t]; if (p && !SEG.temPapel(user, p)) falha(403, SEG.MSG_PAPEL[p]); };
const tabelaOk = t => { if (!TABLES.includes(t)) falha(404, 'Tabela não encontrada.'); };
const idOk = id => { if (!/^\d+$/.test(String(id))) falha(400, 'Id inválido.'); return +id; };
const adminsAtivos = () => get("SELECT COUNT(*) n FROM users WHERE role='Administrador' AND active=1").n;
async function preparaUsuario(b, id) {
  const atual = id ? get('SELECT * FROM users WHERE id=?', id) : null; if (id && !atual) falha(404, 'Usuário não encontrado.');
  const v = SEG.validaCampos('users', b, tipos.users, { ignorar: SEG.PROTEGIDOS.users });
  if (v.email != null) { v.email = String(v.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) falha(400, 'E-mail inválido.');
    if (get('SELECT id FROM users WHERE lower(email)=? AND id<>?', v.email, id || 0)) falha(400, 'Já existe um usuário com esse e-mail.'); }
  if (!id && !v.name) falha(400, 'Informe o nome.');
  if (b.password) v.password = await SEG.hashSenha(SEG.validaSenhaNova(b.password, v.email || atual?.email));
  else if (!id) falha(400, 'Informe uma senha.');
  const deixaDeSerAdmin = atual?.role === SEG.ADMIN && atual.active && ((v.role && v.role !== SEG.ADMIN) || v.active === 0);
  if (deixaDeSerAdmin && adminsAtivos() <= 1) falha(400, 'Precisa haver pelo menos um administrador ativo.');
  return { v, derrubaSessoes: !!id && (v.active === 0 || !!v.password || (v.role && v.role !== atual.role)) };
}
route('GET', '/api/t/:table', (req, res, p, b, user) => {
  tabelaOk(p.table); if (!podeLer(user, p.table)) falha(403, SEG.MSG_PAPEL.admin);
  const q = new URL(req.url, 'http://x').searchParams; const where = []; const args = [];
  for (const [k, v] of q) if (cols[p.table].includes(k) || k === 'id') { where.push(`${k}=?`); args.push(v); }
  const order = p.table === 'logs' ? 'id DESC LIMIT 500' : cols[p.table].includes('ord') ? 'ord,id' : 'id';
  send(res, 200, all(`SELECT * FROM ${p.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`, ...args).map(r => strip(plain(r))));
});
route('GET', '/api/t/:table/:id', (req, res, p, b, user) => {
  tabelaOk(p.table); if (!podeLer(user, p.table)) falha(403, SEG.MSG_PAPEL.admin);
  const r = get(`SELECT * FROM ${p.table} WHERE id=?`, idOk(p.id)); if (!r) falha(404, 'Registro não encontrado.');
  send(res, 200, strip(plain(r)));
});
route('POST', '/api/t/:table', async (req, res, p, b, user) => {
  tabelaOk(p.table); if (p.table === 'logs') falha(404, 'Tabela não encontrada.'); exigeEscrita(user, p.table);
  if (p.table === 'users') b = (await preparaUsuario(b)).v;
  else b = SEG.validaCampos(p.table, b, tipos[p.table], { ignorar: SEG.PROTEGIDOS[p.table] || [] });
  if (p.table === 'docs') falha(400, 'Use o editor de documentos para criar propostas, vendas e documentos.');
  if (p.table === 'deals') { b.stage_changed_at = now(); if (!b.stage_id && b.pipeline_id) b.stage_id = get('SELECT id FROM stages WHERE pipeline_id=? ORDER BY ord LIMIT 1', b.pipeline_id)?.id; }
  if (['contacts', 'deals', 'tasks', 'interactions', 'products'].includes(p.table) && !b.created_at) b.created_at = now();
  if (['deals', 'contacts', 'tasks', 'interactions'].includes(p.table) && !b.owner_id) b.owner_id = user.id;
  if (p.table === 'tasks' && b.done) b.done_at = now();
  const id = insert(p.table, b);
  if (p.table === 'deals') run('INSERT INTO deal_history (deal_id,stage_id,entered_at) VALUES (?,?,?)', id, b.stage_id, now());
  if (p.table === 'interactions' && b.contact_id) run('UPDATE contacts SET last_contact_at=? WHERE id=?', b.date || now(), b.contact_id);
  if (p.table === 'users') demoCache = null;
  log(user, 'criou', p.table, id, b.name || b.title);
  runAutomations(p.table, 'created', id, user);
  send(res, 200, { id });
});
route('PUT', '/api/t/:table/:id', async (req, res, p, b, user) => {
  tabelaOk(p.table); if (p.table === 'logs') falha(404, 'Tabela não encontrada.'); exigeEscrita(user, p.table);
  const id = idOk(p.id);
  if (!get(`SELECT id FROM ${p.table} WHERE id=?`, id)) falha(404, 'Registro não encontrado.');
  let derruba = false;
  if (p.table === 'users') { const x = await preparaUsuario(b, id); b = x.v; derruba = x.derrubaSessoes; }
  else b = SEG.validaCampos(p.table, b, tipos[p.table], { ignorar: SEG.PROTEGIDOS[p.table] || [] });
  if (p.table === 'tasks' && 'done' in b) b.done_at = b.done ? now() : null;
  update(p.table, id, b);
  if (derruba) { SEG.encerraSessoesDo(id); demoCache = null; }
  log(user, 'alterou', p.table, id, Object.keys(b).filter(k => k !== 'password').join(', '));
  send(res, 200, { ok: true });
});
route('DELETE', '/api/t/:table/:id', (req, res, p, b, user) => {
  tabelaOk(p.table); if (p.table === 'logs') falha(404, 'Tabela não encontrada.'); exigeEscrita(user, p.table);
  const id = idOk(p.id);
  if (p.table === 'users') {
    if (id === user.id) falha(400, 'Você não pode excluir o próprio usuário.');
    const alvo = get('SELECT role, active FROM users WHERE id=?', id);
    if (alvo?.role === SEG.ADMIN && alvo.active && adminsAtivos() <= 1) falha(400, 'Precisa haver pelo menos um administrador ativo.');
    SEG.encerraSessoesDo(id);
  }
  run(`DELETE FROM ${p.table} WHERE id=?`, id);
  if (p.table === 'docs') run('DELETE FROM doc_items WHERE doc_id=?', id);
  if (p.table === 'deals') run('DELETE FROM deal_history WHERE deal_id=?', id);
  if (p.table === 'pipelines') run('DELETE FROM stages WHERE pipeline_id=?', id);
  log(user, 'excluiu', p.table, id); send(res, 200, { ok: true });
});

// Importação de clientes em lote (uma transação; linhas com erro são puladas e relatadas)
route('POST', '/api/import/contacts', (req, res, p, b, user) => {
  if (!Array.isArray(b.rows)) falha(400, 'Envie as linhas do arquivo.');
  if (b.rows.length > 5000) falha(400, 'Máximo de 5.000 clientes por importação. Divida o arquivo.');
  const erros = []; let criados = 0; const t = now();
  db.exec('BEGIN');
  try {
    b.rows.forEach((row, i) => {
      try {
        const v = SEG.validaCampos('contacts', row, tipos.contacts);
        if (!v.name) falha(400, 'sem nome');
        if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) falha(400, 'e-mail inválido');
        insert('contacts', { ...v, owner_id: v.owner_id || user.id, created_at: t }); criados++;
      } catch (e) { if (!(e instanceof HttpError)) throw e; erros.push({ linha: i + 1, motivo: e.message }); }
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  log(user, 'importou clientes', 'contacts', null, `${criados} criados, ${erros.length} com erro`);
  send(res, 200, { criados, erros: erros.slice(0, 50), total_erros: erros.length });
});

// Fichas
route('GET', '/api/contact/:id/full', (req, res, p) => {
  const c = plain(get(`SELECT c.*, u.name owner_name, s.name segment_name, o.name origin_name, st.name status_name, co.name company_name FROM contacts c
    LEFT JOIN users u ON u.id=c.owner_id LEFT JOIN options s ON s.id=c.segment_id LEFT JOIN options o ON o.id=c.origin_id
    LEFT JOIN options st ON st.id=c.status_id LEFT JOIN contacts co ON co.id=c.company_id WHERE c.id=?`, p.id));
  if (!c) return send(res, 404, {});
  send(res, 200, {
    contact: c, people: all('SELECT * FROM contacts WHERE company_id=?', p.id).map(plain),
    deals: all('SELECT d.*, s.name stage_name, u.name owner_name FROM deals d LEFT JOIN stages s ON s.id=d.stage_id LEFT JOIN users u ON u.id=d.owner_id WHERE contact_id=? ORDER BY d.id DESC', p.id).map(plain),
    docs: all('SELECT * FROM docs WHERE contact_id=? ORDER BY date DESC', p.id).map(plain),
    tasks: all('SELECT t.*, u.name owner_name, o.name type_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id LEFT JOIN options o ON o.id=t.type_id WHERE contact_id=? ORDER BY date DESC', p.id).map(plain),
    interactions: all('SELECT i.*, u.name owner_name, o.name type_name FROM interactions i LEFT JOIN users u ON u.id=i.owner_id LEFT JOIN options o ON o.id=i.type_id WHERE contact_id=? ORDER BY date DESC', p.id).map(plain),
  });
});
route('GET', '/api/deal/:id/full', (req, res, p) => {
  const d = plain(get(`SELECT d.*, c.name contact_name, c.phone contact_phone, u.name owner_name, o.name origin_name, lr.name loss_reason_name, pl.name pipeline_name FROM deals d
    LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN users u ON u.id=d.owner_id LEFT JOIN options o ON o.id=d.origin_id
    LEFT JOIN options lr ON lr.id=d.loss_reason_id LEFT JOIN pipelines pl ON pl.id=d.pipeline_id WHERE d.id=?`, p.id));
  if (!d) return send(res, 404, {});
  send(res, 200, {
    deal: d, stages: all('SELECT * FROM stages WHERE pipeline_id=? ORDER BY ord', d.pipeline_id).map(plain),
    history: all('SELECT h.*, s.name stage_name FROM deal_history h JOIN stages s ON s.id=h.stage_id WHERE deal_id=? ORDER BY h.id', p.id).map(plain),
    docs: all('SELECT * FROM docs WHERE deal_id=? ORDER BY kind,date DESC', p.id).map(plain),
    tasks: all('SELECT t.*, u.name owner_name, o.name type_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id LEFT JOIN options o ON o.id=t.type_id WHERE deal_id=? ORDER BY date DESC', p.id).map(plain),
    interactions: all('SELECT i.*, u.name owner_name, o.name type_name FROM interactions i LEFT JOIN users u ON u.id=i.owner_id LEFT JOIN options o ON o.id=i.type_id WHERE deal_id=? ORDER BY date DESC', p.id).map(plain),
  });
});
route('POST', '/api/deals/:id/move', (req, res, p, b, user) => {
  const d = get('SELECT * FROM deals WHERE id=?', p.id); if (!d) return send(res, 404, {});
  if (!get('SELECT id FROM stages WHERE id=? AND pipeline_id=?', b.stage_id, d.pipeline_id)) falha(400, 'Estágio inválido para este funil.');
  if (d.stage_id !== +b.stage_id) {
    const t = now();
    run('UPDATE deal_history SET left_at=? WHERE deal_id=? AND left_at IS NULL', t, p.id);
    run('INSERT INTO deal_history (deal_id,stage_id,entered_at) VALUES (?,?,?)', p.id, b.stage_id, t);
    run('UPDATE deals SET stage_id=?, stage_changed_at=? WHERE id=?', b.stage_id, t, p.id);
    log(user, 'moveu estágio', 'deals', +p.id, get('SELECT name FROM stages WHERE id=?', b.stage_id)?.name);
    runAutomations('deals', 'stage', +p.id, user, +b.stage_id);
  }
  send(res, 200, { ok: true });
});
route('POST', '/api/deals/:id/status', (req, res, p, b, user) => {
  if (!SEG.ENUMS.deals.status.includes(b.status)) falha(400, 'Situação inválida.');
  if (!get('SELECT id FROM deals WHERE id=?', p.id)) falha(404, 'Negócio não encontrado.');
  const t = now();
  run('UPDATE deals SET status=?, loss_reason_id=?, closed_at=? WHERE id=?', b.status, b.status === 'lost' ? b.loss_reason_id || null : null, b.status === 'open' ? null : t, p.id);
  if (b.status !== 'open') run('UPDATE deal_history SET left_at=? WHERE deal_id=? AND left_at IS NULL', t, p.id);
  log(user, b.status === 'won' ? 'ganhou' : b.status === 'lost' ? 'perdeu' : 'reabriu', 'deals', +p.id);
  runAutomations('deals', b.status, +p.id, user);
  send(res, 200, { ok: true });
});

// Documentos (proposta/venda/documento)
route('GET', '/api/doc/:id/full', (req, res, p) => {
  const d = plain(get(`SELECT q.*, c.name contact_name, c.doc contact_doc, c.email contact_email, c.phone contact_phone, c.city contact_city, c.state contact_state,
    u.name owner_name, dl.title deal_title FROM docs q LEFT JOIN contacts c ON c.id=q.contact_id LEFT JOIN users u ON u.id=q.owner_id
    LEFT JOIN deals dl ON dl.id=q.deal_id WHERE q.id=?`, p.id));
  if (!d) return send(res, 404, {});
  send(res, 200, { doc: d, items: all('SELECT i.*, p.name product_name, p.code product_code, p.unit FROM doc_items i LEFT JOIN products p ON p.id=i.product_id WHERE doc_id=? ORDER BY ord,id', p.id).map(plain) });
});
route('POST', '/api/doc/save', (req, res, p, b, user) => {
  const docId = b.doc?.id ? +b.doc.id : null;
  if (docId && !get('SELECT id FROM docs WHERE id=?', docId)) falha(404, 'Documento não encontrado.');
  const doc = SEG.validaCampos('docs', b.doc || {}, tipos.docs, { ignorar: SEG.PROTEGIDOS.docs });
  if (!docId && !doc.kind) falha(400, 'Informe o tipo do documento.');
  if (!Array.isArray(b.items || [])) falha(400, 'Itens inválidos.');
  const items = (b.items || []).slice(0, 500).map(it => SEG.validaCampos('doc_items', it, tipos.doc_items, { ignorar: ['doc_id', 'ord', 'total'] }));
  if (docId) doc.id = docId;
  let total = 0;
  const its = items.map((it, i) => { const t = Math.round((+it.qty || 0) * (+it.unit_price || 0) * (1 - (+it.discount || 0) / 100) * 100) / 100; total += t; return { ...it, total: t, ord: i }; });
  total = Math.round(total * (1 - (+doc.discount || 0) / 100) * 100) / 100;
  doc.total = total;
  let id = docId; delete doc.id;
  if (id) update('docs', id, doc);
  else {
    doc.number = (get('SELECT MAX(number) n FROM docs WHERE kind=?', doc.kind)?.n || ({ quote: 1000, order: 5000, document: 100 }[doc.kind] || 0)) + 1;
    doc.owner_id ||= user.id; doc.date ||= now(); doc.created_at = now();
    if (doc.deal_id && !doc.contact_id) doc.contact_id = get('SELECT contact_id FROM deals WHERE id=?', doc.deal_id)?.contact_id;
    id = insert('docs', doc);
  }
  run('DELETE FROM doc_items WHERE doc_id=?', id);
  for (const it of its) insert('doc_items', { ...it, doc_id: id, id: undefined });
  log(user, docId ? 'alterou' : 'criou', 'docs', id, doc.title);
  send(res, 200, { id, total });
});
route('POST', '/api/doc/:id/revise', (req, res, p, b, user) => {
  const d = get('SELECT * FROM docs WHERE id=?', p.id); if (!d) return send(res, 404, {});
  const n = { ...plain(d), revision: (d.revision || 1) + 1, status: 'open', created_at: now(), date: now() }; delete n.id;
  run("UPDATE docs SET status='lost' WHERE id=? AND status='open'", p.id);
  const id = insert('docs', n);
  for (const it of all('SELECT * FROM doc_items WHERE doc_id=?', p.id)) { const x = plain(it); delete x.id; insert('doc_items', { ...x, doc_id: id }); }
  log(user, 'revisou', 'docs', id); send(res, 200, { id });
});
route('POST', '/api/doc/:id/convert', (req, res, p, b, user) => {
  const q = get('SELECT * FROM docs WHERE id=?', p.id); if (!q) return send(res, 404, {});
  run("UPDATE docs SET status='won' WHERE id=?", p.id);
  const n = { ...plain(q), kind: 'order', status: 'won', revision: 1, date: now(), created_at: now(), title: String(q.title || '').replace(/^Proposta comercial/, 'Pedido'),
    number: (get("SELECT MAX(number) n FROM docs WHERE kind='order'")?.n || 5000) + 1, stage_id: get("SELECT id FROM options WHERE kind='order_stage' ORDER BY ord LIMIT 1")?.id };
  delete n.id;
  const id = insert('docs', n);
  for (const it of all('SELECT * FROM doc_items WHERE doc_id=?', p.id)) { const x = plain(it); delete x.id; insert('doc_items', { ...x, doc_id: id }); }
  if (q.deal_id) { run("UPDATE deals SET status='won', amount=?, closed_at=? WHERE id=?", q.total, now(), q.deal_id); run('UPDATE deal_history SET left_at=? WHERE deal_id=? AND left_at IS NULL', now(), q.deal_id); }
  log(user, 'gerou venda', 'docs', id); send(res, 200, { id });
});

// Relatórios
route('GET', '/api/reports/panels', (req, res) => send(res, 200, all('SELECT p.*, (SELECT COUNT(*) FROM charts c WHERE c.panel_id=p.id) charts FROM report_panels p ORDER BY ord,id').map(plain)));
route('GET', '/api/reports/panel/:id', (req, res, p) => {
  const panel = plain(get('SELECT * FROM report_panels WHERE id=?', p.id)); if (!panel) return send(res, 404, {});
  send(res, 200, { panel, charts: all('SELECT id FROM charts WHERE panel_id=? ORDER BY ord,id', p.id).map(c => chartFull(c.id)),
    filters: all('SELECT * FROM panel_filters WHERE panel_id=? ORDER BY ord,id', p.id).map(filterOut) });
});
route('POST', '/api/reports/panel/:id/duplicate', (req, res, p, b, user) => {
  const src = get('SELECT * FROM report_panels WHERE id=?', p.id);
  const np = insert('report_panels', { name: `${src.name} (cópia)`, ord: (src.ord || 0) + 1, description: src.description });
  const metricMap = {};
  for (const c of all('SELECT * FROM charts WHERE panel_id=?', p.id)) {
    const x = plain(c); delete x.id; x.cache = null; x.cache_at = null;
    const nc = Number(run(`INSERT INTO charts (${Object.keys(x).join(',')}) VALUES (${Object.keys(x).map(() => '?').join(',')})`, ...Object.values({ ...x, panel_id: np })).lastInsertRowid);
    for (const m of all('SELECT * FROM metrics WHERE chart_id=?', c.id)) { const y = plain(m); const old = y.id; delete y.id; y.chart_id = nc; metricMap[old] = Number(run(`INSERT INTO metrics (${Object.keys(y).join(',')}) VALUES (${Object.keys(y).map(() => '?').join(',')})`, ...Object.values(y)).lastInsertRowid); }
  }
  for (const f of all('SELECT * FROM panel_filters WHERE panel_id=?', p.id)) {
    const map = Object.fromEntries(Object.entries(J(f.map) || {}).map(([k, v]) => [metricMap[k], v]).filter(([k]) => k));
    insert('panel_filters', { panel_id: np, type: f.type, name: f.name, ord: f.ord, value: f.value, active: 0, map: JSON.stringify(map) });
  }
  log(user, 'duplicou painel', 'report_panels', np); send(res, 200, { id: np });
});
route('DELETE', '/api/reports/panel/:id', (req, res, p, b, user) => {
  if (!SEG.ehGestor(user)) falha(403, SEG.MSG_PAPEL.gestor);
  for (const c of all('SELECT id FROM charts WHERE panel_id=?', p.id)) { run('DELETE FROM metrics WHERE chart_id=?', c.id); }
  run('DELETE FROM charts WHERE panel_id=?', p.id); run('DELETE FROM panel_filters WHERE panel_id=?', p.id); run('DELETE FROM report_panels WHERE id=?', p.id);
  log(user, 'excluiu painel', 'report_panels', +p.id); send(res, 200, { ok: true });
});
route('POST', '/api/reports/chart', (req, res, p, b, user) => {
  const c = b.chart || {}; const metrics = b.metrics || [];
  const fields = { panel_id: c.panel_id, type: c.type, name: c.name || 'Novo gráfico', description: c.description || null, w: c.w || 6, h: c.h || 8,
    metric_limit: c.metric_limit ?? 10, order_asc: c.order_asc ? 1 : 0, pipeline_id: c.pipeline_id || null, history_months: c.history_months || 6, cache: null, cache_at: null };
  let id = c.id;
  if (id) { const k = Object.keys(fields); run(`UPDATE charts SET ${k.map(x => `${x}=?`).join(',')} WHERE id=?`, ...k.map(x => fields[x]), id); }
  else { fields.ord = (get('SELECT MAX(ord) m FROM charts WHERE panel_id=?', c.panel_id)?.m ?? -1) + 1; const k = Object.keys(fields); id = Number(run(`INSERT INTO charts (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map(x => fields[x])).lastInsertRowid); }
  const keep = [];
  metrics.forEach((m, i) => {
    const f = { chart_id: id, entity: m.entity, name: m.name, aggregator: m.aggregator || 'count', field: m.field || null, color: m.color, visible: m.visible === false ? 0 : 1,
      ord: i, filter: JSON.stringify(m.filter || { conditions: [] }), dims: JSON.stringify(m.dims || []) };
    const k = Object.keys(f);
    if (m.id && get('SELECT id FROM metrics WHERE id=? AND chart_id=?', m.id, id)) { run(`UPDATE metrics SET ${k.map(x => `${x}=?`).join(',')} WHERE id=?`, ...k.map(x => f[x]), m.id); keep.push(+m.id); }
    else keep.push(Number(run(`INSERT INTO metrics (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map(x => f[x])).lastInsertRowid));
  });
  for (const m of all('SELECT id FROM metrics WHERE chart_id=?', id)) if (!keep.includes(m.id)) run('DELETE FROM metrics WHERE id=?', m.id);
  // remove mapeamentos órfãos de filtros do painel
  for (const f of all('SELECT * FROM panel_filters WHERE panel_id=?', c.panel_id)) {
    const map = J(f.map) || {}; let changed = false;
    for (const k of Object.keys(map)) if (!get('SELECT id FROM metrics WHERE id=?', k)) { delete map[k]; changed = true; }
    if (changed) run('UPDATE panel_filters SET map=? WHERE id=?', JSON.stringify(map), f.id);
  }
  log(user, c.id ? 'alterou gráfico' : 'criou gráfico', 'charts', id, c.name);
  send(res, 200, chartFull(id));
});
route('DELETE', '/api/reports/chart/:id', (req, res, p, b, user) => { run('DELETE FROM metrics WHERE chart_id=?', p.id); run('DELETE FROM charts WHERE id=?', p.id); log(user, 'excluiu gráfico', 'charts', +p.id); send(res, 200, { ok: true }); });
route('POST', '/api/reports/chart/:id/duplicate', (req, res, p, b, user) => {
  const c = chartFull(p.id); const panelId = b.panel_id || c.panel_id;
  const metrics = c.metrics.map(m => ({ ...m, id: undefined }));
  const fields = { ...c, id: undefined, panel_id: panelId, name: b.panel_id ? c.name : `${c.name} (cópia)` }; delete fields.metrics;
  const k = Object.keys(fields).filter(x => fields[x] !== undefined && x !== 'cache_at');
  const id = Number(run(`INSERT INTO charts (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map(x => fields[x])).lastInsertRowid);
  metrics.forEach((m, i) => run('INSERT INTO metrics (chart_id,entity,name,aggregator,field,color,visible,ord,filter,dims) VALUES (?,?,?,?,?,?,?,?,?,?)', id, m.entity, m.name, m.aggregator, m.field, m.color, m.visible ? 1 : 0, i, JSON.stringify(m.filter), JSON.stringify(m.dims)));
  if (b.move) { run('DELETE FROM metrics WHERE chart_id=?', p.id); run('DELETE FROM charts WHERE id=?', p.id); }
  log(user, b.move ? 'moveu gráfico' : 'duplicou gráfico', 'charts', id); send(res, 200, { id });
});
route('POST', '/api/reports/layout', (req, res, p, b) => { for (const it of b.items || []) run('UPDATE charts SET w=?, h=?, ord=? WHERE id=?', it.w, it.h, it.ord, it.id); send(res, 200, { ok: true }); });
route('POST', '/api/reports/calc', (req, res, p, b) => {
  const c = chartFull(b.chart_id); if (!c) return send(res, 404, {});
  const active = (b.filters || []).filter(f => f.active);
  const raw = get('SELECT cache, cache_at FROM charts WHERE id=?', c.id);
  const fresh = raw.cache_at && (Date.now() - new Date(raw.cache_at.replace(' ', 'T')).getTime()) < 10 * 60000;
  if (!b.force && !active.length && fresh && raw.cache) return send(res, 200, { result: J(raw.cache), cache_at: raw.cache_at });
  const result = calcChart(c, active); const at = now();
  if (!active.length) run('UPDATE charts SET cache=?, cache_at=? WHERE id=?', JSON.stringify(result), at, c.id);
  send(res, 200, { result, cache_at: at });
});
route('POST', '/api/reports/preview', (req, res, p, b) => send(res, 200, { result: calcChart({ ...b.chart, metrics: (b.metrics || []).map((m, i) => ({ ...m, id: m.id || `tmp${i}` })) }, []) }));
route('POST', '/api/reports/drill', (req, res, p, b) => {
  const m = b.metric_id ? metricOut(get('SELECT * FROM metrics WHERE id=?', b.metric_id)) : b.metric;
  if (!m) return send(res, 404, {});
  const ent = ENTITIES[m.entity]; if (!ent) falha(400, 'Entidade inválida.');
  const list = drillRows(m, rows(m.entity), (b.filters || []).filter(f => f.active), b.keys || []);
  send(res, 200, { entity: m.entity, fields: ent.fields.map(([k, l, t]) => ({ key: k, label: l, type: t })), rows: list.slice(0, 1000), total: list.length });
});
route('POST', '/api/reports/filter', (req, res, p, b, user) => {
  const f = { panel_id: b.panel_id, type: b.type, name: b.name, ord: b.ord || 0, value: JSON.stringify(b.value || {}), active: b.active ? 1 : 0, map: JSON.stringify(b.map || {}) };
  let id = b.id;
  if (id) { const k = Object.keys(f); run(`UPDATE panel_filters SET ${k.map(x => `${x}=?`).join(',')} WHERE id=?`, ...k.map(x => f[x]), id); }
  else { const k = Object.keys(f); id = Number(run(`INSERT INTO panel_filters (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map(x => f[x])).lastInsertRowid); }
  send(res, 200, filterOut(get('SELECT * FROM panel_filters WHERE id=?', id)));
});
route('DELETE', '/api/reports/filter/:id', (req, res, p) => { run('DELETE FROM panel_filters WHERE id=?', p.id); send(res, 200, { ok: true }); });
route('GET', '/api/reports/stages/:pipeline', (req, res, p) => send(res, 200, all('SELECT * FROM stages WHERE pipeline_id=? ORDER BY ord', p.pipeline).map(plain)));

// Metas e resumo
route('GET', '/api/goals', (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams; const off = +(q.get('offset') || 0);
  const gs = all(`SELECT g.*, u.name user_name, t.name team_name FROM goals g LEFT JOIN users u ON u.id=g.user_id LEFT JOIN teams t ON t.id=g.team_id ${q.get('panel_id') ? 'WHERE panel_id=' + (+q.get('panel_id')) : ''} ORDER BY g.id`).map(plain);
  send(res, 200, gs.map(g => ({ ...g, filter: J(g.filter), progress: goalProgress(g, off), history: [-5, -4, -3, -2, -1, 0].map(o => goalProgress(g, off + o)) })));
});
route('GET', '/api/dashboard', (req, res, p, b, user) => {
  const today = ymd(new Date()); const m0 = today.slice(0, 7);
  const kpi = {
    dealsOpen: get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE status='open'"),
    dealsMonth: get("SELECT COUNT(*) n FROM deals WHERE substr(created_at,1,7)=?", m0),
    wonMonth: get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE status='won' AND substr(closed_at,1,7)=?", m0),
    ordersMonth: get("SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM docs WHERE kind='order' AND substr(date,1,7)=?", m0),
    quotesMonth: get("SELECT COUNT(*) n FROM docs WHERE kind='quote' AND substr(date,1,7)=?", m0),
    contactsMonth: get("SELECT COUNT(*) n FROM contacts WHERE substr(created_at,1,7)=?", m0),
  };
  send(res, 200, {
    kpi: Object.fromEntries(Object.entries(kpi).map(([k, v]) => [k, plain(v)])),
    tasksToday: all("SELECT t.*, c.name contact_name, u.name owner_name, o.name type_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN users u ON u.id=t.owner_id LEFT JOIN options o ON o.id=t.type_id WHERE t.date<=? AND t.done=0 ORDER BY t.date, t.time LIMIT 30", today).map(plain),
    recentDeals: all("SELECT d.*, c.name contact_name, s.name stage_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN stages s ON s.id=d.stage_id ORDER BY d.created_at DESC LIMIT 8").map(plain),
    activity: all("SELECT l.*, u.name user_name FROM logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.action NOT IN ('login', 'logout') ORDER BY l.id DESC LIMIT 10").map(plain),
  });
});
const semToken = (c, user) => (c && !SEG.ehAdmin(user) ? { ...c, lp_token: undefined } : c);
route('GET', '/api/settings', (req, res, p, b, user) => send(res, 200, Object.fromEntries(all('SELECT * FROM settings').map(s => [s.key, s.key === 'whatsapp' ? semToken(J(s.value), user) : J(s.value)]))));
route('PUT', '/api/settings/:key', (req, res, p, b, user) => {
  if (!/^[a-z_]{1,40}$/.test(p.key) || p.key === 'whatsapp') falha(400, 'Configuração inválida.'); run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', p.key, JSON.stringify(b)); log(user, 'alterou configuração', 'settings', null, p.key); send(res, 200, { ok: true }); }, { papel: 'admin' });


// ---------- WhatsApp (trazido do CRM de Tráfego) ----------
const PORT_INFO = () => ({ porta: PORT, host: HOST, enderecos: HOST === '127.0.0.1' ? [] : Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORT}`) });
route('GET', '/api/whatsapp', (req, res, p, b, user) => {
  const c = WA.config();
  const stats = get(`SELECT COUNT(*) total, SUM(created_at >= date('now','localtime','start of month')) mes, SUM(source='lp') lp,
    SUM(platform='instagram') ig, SUM(platform='facebook') fb, COALESCE(SUM(returns),0) retornos FROM deals WHERE source IS NOT NULL`);
  send(res, 200, { ...WA.statusWhatsapp(), config: semToken(c, user), stats: plain(stats), lp_numero: WA.numeroDaPagina(), rede: PORT_INFO(), admin: SEG.ehAdmin(user) });
});
route('POST', '/api/whatsapp/conectar', async (req, res, p, b, user) => { log(user, 'vincular WhatsApp', 'whatsapp', null, b.modo || 'qr'); send(res, 200, await WA.conectar({ modo: b.modo, telefone: b.telefone })); }, { papel: 'admin' });
route('POST', '/api/whatsapp/desconectar', async (req, res, p, b) => { await WA.desconectar({ desvincular: b.desvincular !== false }); send(res, 200, { ok: true }); }, { papel: 'admin' });
route('PUT', '/api/whatsapp/config', (req, res, p, b, user) => {
  const c = { only_ads: !!b.only_ads, pipeline_id: +b.pipeline_id || null, stage_id: +b.stage_id || null, owner_id: +b.owner_id || null,
    return_hours: Math.max(1, +b.return_hours || 24), lp_message: String(b.lp_message || '').slice(0, 300) || undefined };
  let n = String(b.lp_number || '').replace(/\D/g, ''); if (n && n.length <= 11) n = '55' + n;
  if (n && (n.length < 12 || n.length > 13)) return send(res, 400, { error: 'Número da página: informe com DDD, ex.: 71 98764-2917' });
  c.lp_number = n;
  WA.salvarConfig(c); log(user, 'alterou configuração', 'settings', null, 'whatsapp'); send(res, 200, WA.config());
}, { papel: 'admin' });
route('GET', '/api/whatsapp/leads', (req, res) => send(res, 200, all(`SELECT d.id, d.title, d.status, d.source, d.platform, d.ad_title, d.ad_id, d.utm_campaign, d.returns,
  d.recent_platform, d.recent_ad_title, d.last_message, d.last_message_at, d.created_at, s.name stage_name, c.name contact_name, c.phone contact_phone
  FROM deals d LEFT JOIN stages s ON s.id=d.stage_id LEFT JOIN contacts c ON c.id=d.contact_id WHERE d.source IS NOT NULL
  ORDER BY COALESCE(d.last_message_at, d.created_at) DESC LIMIT 100`).map(plain)));
// Teste sem celular: simula a 1ª mensagem de alguém (de anúncio, sem anúncio ou com o código da landing page)
route('POST', '/api/whatsapp/simular', (req, res, p, b) => {
  const tel = String(b.telefone || `55719${Math.floor(10000000 + Math.random() * 89999999)}`).replace(/\D/g, '');
  const cod = String(b.codigo || '').toUpperCase().replace(/^LP-/, '');
  const texto = String(b.texto || 'Olá! Vi o anúncio e quero saber mais.') + (/^[A-Z2-9]{5}$/.test(cod) ? WA.codigoInvisivel(cod) : '');
  const origem = b.tipo === 'anuncio' ? { anuncio_id: '1202' + Math.floor(Math.random() * 1e8), anuncio_titulo: b.anuncio_titulo || 'Avaliação gratuita',
    anuncio_url: b.plataforma === 'facebook' ? 'https://fb.me/teste' : 'https://www.instagram.com/p/teste', ctwa_clid: 'teste', plataforma: b.plataforma || 'instagram' } : null;
  const id = WA.receberContato({ jid: `${tel}@s.whatsapp.net`, telefone: tel, nome: b.nome || 'Lead de teste', texto, origem });
  send(res, 200, { id, criado: !!id, ignorado: !id });
}, { papel: 'admin' });
// Tempo real (Server-Sent Events)
route('GET', '/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const ouvir = ev => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  WA.bus.on('evento', ouvir);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { WA.bus.off('evento', ouvir); clearInterval(ping); });
});
// Landing page e webhook (públicos, identificados pelo token)
const CAMPOS_LEAD = ['nome', 'telefone', 'whatsapp', 'phone', 'email', 'mensagem', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'pagina'];
const limpaLead = b => Object.fromEntries(CAMPOS_LEAD.filter(k => b[k] != null && typeof b[k] !== 'object').map(k => [k,
  ['telefone', 'whatsapp', 'phone'].includes(k) ? String(b[k]).replace(/\D/g, '').slice(0, 15) : String(b[k]).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, k === 'mensagem' ? 1000 : 200)]));
const tokenOk = t => { const k = WA.config().lp_token; return !!t && !!k && t.length === k.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(k)); };
route('POST', '/api/webhook/lp/:token', (req, res, p, b) => {
  b = limpaLead(b);
  if (!tokenOk(p.token)) return send(res, 404, { error: 'Token inválido.' });
  if (!String(b.telefone || b.whatsapp || b.phone || '').replace(/\D/g, '') && !b.nome) return send(res, 400, { error: 'Envie nome ou telefone.' });
  send(res, 200, { ok: true, ...WA.leadDeFormulario(b) });
}, { open: true, publica: true });
route('GET', '/api/lp/:token', (req, res, p) => tokenOk(p.token) ? send(res, 200, { empresa: J(get("SELECT value FROM settings WHERE key='company'")?.value)?.name || 'Crmdss', whatsapp: WA.numeroDaPagina() }) : send(res, 404, { error: 'Página não encontrada.' }), { open: true, publica: true });
const cliquesPorIp = SEG.limitador(20, 600e3);
route('POST', '/api/lp/:token/clique', (req, res, p, b) => {
  b = limpaLead(b);
  if (!tokenOk(p.token)) return send(res, 404, { error: 'Página não encontrada.' });
  if (!cliquesPorIp(SEG.ipDe(req))) return send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
  const numero = WA.numeroDaPagina(); if (!numero) return send(res, 409, { error: 'O WhatsApp da empresa não está conectado ao CRM agora.' });
  const tel = String(b.telefone || '').replace(/\D/g, '');
  if (tel && (tel.length < 10 || tel.length > 13)) return send(res, 400, { error: 'Confira o número de WhatsApp, com DDD.' });
  const lead = tel ? WA.leadDeFormulario(b) : null;
  let code; do { code = Array.from(crypto.randomBytes(5), x => WA.ALFABETO_CODIGO[x % 32]).join(''); } while (get('SELECT 1 FROM lp_clicks WHERE code=?', code));
  const u = k => (b[k] ? String(b[k]).slice(0, 120) : null);
  run('INSERT INTO lp_clicks (code,deal_id,name,phone,utm_source,utm_medium,utm_campaign,utm_content,utm_term,page,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    code, lead?.id || null, u('nome'), tel || null, u('utm_source'), u('utm_medium'), u('utm_campaign'), u('utm_content'), u('utm_term'), u('pagina'), now());
  const primeiro = String(b.nome || '').trim().split(/\s+/)[0];
  const mensagem = (WA.config().lp_message || 'Olá{nome}!').replace('{nome}', primeiro ? `, sou ${primeiro}` : '') + WA.codigoInvisivel(code);
  send(res, 200, { codigo: code, numero, mensagem, link: `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` });
}, { open: true, publica: true });

// ---------- automações simples ----------
function runAutomations(table, trigger, id, user, value) {
  const entity = { deals: 'deal', contacts: 'contact', tasks: 'task' }[table]; if (!entity) return;
  for (const a of all('SELECT * FROM automations WHERE active=1 AND entity=? AND trigger=?', entity, trigger)) {
    if (trigger === 'stage' && a.trigger_value && +a.trigger_value !== value) continue;
    const d = entity === 'deal' ? get('SELECT * FROM deals WHERE id=?', id) : null;
    if (a.action === 'create_task') {
      const due = new Date(); due.setDate(due.getDate() + (J(a.action_value)?.days || 1));
      run('INSERT INTO tasks (title,date,contact_id,deal_id,owner_id,created_at) VALUES (?,?,?,?,?,?)', J(a.action_value)?.title || a.name, ymd(due),
        d?.contact_id || (entity === 'contact' ? id : null), d?.id || null, d?.owner_id || user?.id, now());
    }
    log(user, `automação: ${a.name}`, table, id);
  }
}

// ---------- servidor ----------
const CABECALHOS = SEG.cabecalhos([...SEG.hashScripts(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')), ...SEG.hashScripts(fs.readFileSync(path.join(PUB, 'lp.html'), 'utf8'))]);
const limSessao = SEG.limitador(+process.env.CRM_LIMITE_SESSAO || 600, 60e3); // por sessão, por minuto
const limIp = SEG.limitador(+process.env.CRM_LIMITE_IP || 300, 60e3);         // sem login, por IP, por minuto
const LIVRES_DE_LIMITE = new Set(['/api/stream']);
const recentes = new Map(); // envios recentes (proteção contra duplo envio)
setInterval(() => { const n = Date.now(); for (const [k, v] of recentes) if (n - v.at > 3000) recentes.delete(k); }, 10e3).unref();

async function atender(req, res) {
  for (const [k, v] of Object.entries(CABECALHOS)) res.setHeader(k, v);
  let url, caminho;
  try { url = new URL(req.url, 'http://x'); caminho = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Endereço inválido.'); }
  if (url.pathname.startsWith('/api/')) {
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    if (!r) return send(res, 404, { error: 'Rota não encontrada.' });
    if (!r.publica) {
      if (!SEG.hostsPermitidos(PORT, HOST).has(String(req.headers.host || '').toLowerCase())) return send(res, 421, { error: 'Endereço não autorizado.' });
      if (!SEG.origemOk(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    }
    const token = cookie(req).sid; const sess = SEG.sessaoValida(token);
    const u = sess ? get('SELECT * FROM users WHERE id=? AND active=1', sess.uid) : null;
    if (sess && !u) SEG.encerraSessao(token);
    if (!LIVRES_DE_LIMITE.has(url.pathname) && !(u ? limSessao(token) : limIp(SEG.ipDe(req)))) return send(res, 429, { error: 'Muitas requisições. Aguarde um instante.' });
    if (!r.open && !u) return send(res, 401, { error: 'Sessão expirada. Entre de novo.' });
    if (u && sess.trocar && !r.livreTroca) return send(res, 403, { error: 'Troque a senha padrão para continuar.', trocar_senha: true });
    if (r.papel && !SEG.temPapel(u, r.papel)) return send(res, 403, { error: SEG.MSG_PAPEL[r.papel] });
    const b = ['POST', 'PUT'].includes(req.method) ? await body(req, r.publica) : {};
    const executa = () => r.fn(req, res, url.pathname.match(r.re).groups || {}, b, u ? strip(plain(u)) : null, { sess, token });
    if (req.method !== 'POST' || !u || url.pathname === '/api/logout') return executa();
    const chave = `${token}|${url.pathname}|${crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex')}`;
    const anterior = recentes.get(chave);
    if (anterior && Date.now() - anterior.at < 3000) { const x = await anterior.p; if (x.erro) throw x.erro; return send(res, x.status, x.dados); }
    let fim; recentes.set(chave, { at: Date.now(), p: new Promise(ok => { fim = ok; }) });
    try { await executa(); fim({ status: res.statusCode, dados: res._dados }); } catch (e) { fim({ erro: e }); throw e; }
    return;
  }
  if (/^\/lp\/[\w-]+$/.test(url.pathname)) { res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }); return fs.createReadStream(path.join(PUB, 'lp.html')).pipe(res); }
  let file = path.normalize(path.join(PUB, caminho));
  if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
const server = http.createServer((req, res) => {
  atender(req, res).catch(e => {
    if (e instanceof HttpError) { if (!res.headersSent) send(res, e.status, { error: e.message, ...(e.extra || {}) }); else res.destroy(); return; }
    console.error(new Date().toISOString(), req.method, req.url.split('?')[0], e);
    if (!res.headersSent) send(res, 500, { error: 'Erro interno. Tente de novo; se continuar, avise o administrador.' }); else res.destroy();
  });
});
server.on('clientError', (e, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
server.listen(PORT, HOST, () => { console.log(`Crmdss rodando em http://localhost:${PORT}`); for (const e of PORT_INFO().enderecos) console.log(`  na rede: ${e}`); });
