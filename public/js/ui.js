// Utilitários de interface: DOM, API, formatação, modais, menus, filtros e listas.
import { ENTITIES, OPERATORS, RELATIVE_DATES, operatorsFor, NUMERIC } from './schema.js';
import { matchFilter } from './engine.js';
import { icon, glyphNodes } from './icons.js';
export { icon };

export const state = { me: null, meta: null };

// ---------- DOM ----------
// Rede de segurança: append/prepend nativos escrevem "null"/"undefined"/"false" como texto.
// Aqui valores vazios são simplesmente ignorados, como já acontece dentro de h().
for (const proto of [Element.prototype, DocumentFragment.prototype]) for (const nome of ['append', 'prepend']) {
  const original = proto[nome];
  proto[nome] = function (...nos) { return original.apply(this, nos.filter(n => n != null && n !== false)); };
}
export function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  for (const p of (m?.[2] || '').match(/[.#][\w-]+/g) || []) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  // texto com caractere de ícone ('⟳ Atualizar', '✕', 'ph:target') vira ícone Phosphor; <option> fica só com texto
  const ok = !['OPTION', 'TITLE', 'TEXTAREA'].includes(el.tagName);
  const add = c => { if (c == null || c === false) return; if (Array.isArray(c)) return c.forEach(add); if (c instanceof Node) return el.append(c);
    const g = ok && typeof c === 'string' && c.length < 80 ? glyphNodes(c) : null; if (g) el.append(...g); else el.append(document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const clear = el => { el.innerHTML = ''; return el; };

// ---------- marca Crmdss ----------
export const LOGO_MARK = (size = 30) => `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#14213d"/><path d="M33.2 14.8A13 13 0 1 0 33.2 33.2" fill="none" stroke="#fca311" stroke-width="5.5" stroke-linecap="round"/><rect x="17" y="25" width="3.6" height="5" rx="1" fill="#e5e5e5"/><rect x="22.2" y="21.5" width="3.6" height="8.5" rx="1" fill="#e5e5e5"/><rect x="27.4" y="17.5" width="3.6" height="12.5" rx="1" fill="#fff"/></svg>`;
export const marca = (size = 30) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } }, h('span', { html: LOGO_MARK(size), style: { display: 'inline-flex' } }), h('span.wordmark', 'Crm', h('b', 'dss')));

// ---------- API ----------
export async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401 && !path.startsWith('/login')) { location.hash = '#/login'; throw new Error('Sessão expirada'); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 403 && data.trocar_senha) window.dispatchEvent(new Event('lente:trocar-senha'));
  if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
  return data;
}
export const save = (table, obj) => obj.id ? api(`/t/${table}/${obj.id}`, { method: 'PUT', body: obj }).then(() => ({ id: obj.id })) : api(`/t/${table}`, { body: obj });
export const del = (table, id) => api(`/t/${table}/${id}`, { method: 'DELETE' });
export async function loadMeta() { state.meta = await api('/meta'); return state.meta; }
export const opts = kind => state.meta?.options?.[kind] || [];
export const userName = id => state.meta?.users.find(u => u.id === +id)?.name || '';
export const optName = id => Object.values(state.meta?.options || {}).flat().find(o => o.id === +id)?.name || '';

// ---------- formatação ----------
export const money = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const num = (v, d = 0) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
// valor curto para cabeçalhos: R$ 2,2 mi · R$ 152 mil · R$ 980
export const moneyShort = v => { const n = Number(v) || 0, a = Math.abs(n); return a >= 1e6 ? `R$ ${num(n / 1e6, 1)} mi` : a >= 1e4 ? `R$ ${num(n / 1e3, 0)} mil` : money(n).replace(/,00$/, ''); };
export const compact = v => Math.abs(v) >= 1e6 ? `${num(v / 1e6, 1)} mi` : Math.abs(v) >= 1e4 ? `${num(v / 1e3, 1)} mil` : num(v, 2);
export const date = v => { if (!v) return ''; const [y, m, d] = String(v).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
export const dateTime = v => v ? `${date(v)} ${String(v).slice(11, 16)}` : '';
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const initials = n => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
// Célula CSV: aspas escapadas e neutraliza fórmulas (=, +, -, @) que o Excel executaria.
export const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
export const csvLinhas = linhas => linhas.map(l => l.map(csvCell).join(';')).join('\n');
// "hoje", "ontem", "há 12 dias", "há 3 meses"
export const relativo = v => { if (!v) return ''; const d = Math.floor((Date.now() - new Date(String(v).replace(' ', 'T')).getTime()) / 864e5);
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : d < 45 ? `há ${d} dias` : d < 365 ? `há ${Math.round(d / 30)} meses` : `há ${Math.round(d / 365)} ano${d >= 730 ? 's' : ''}`; };
const TOM = { 'ganha': 'won', 'ganho': 'won', 'ativo': 'won', 'concluída': 'won', 'concluida': 'won', 'finalizada': 'won', 'perdida': 'lost', 'perdido': 'lost',
  'inativo': 'lost', 'cancelada': 'lost', 'cancelado': 'lost', 'suspenso': 'lost', 'atrasada': 'warn', 'vencida': 'warn' };
const ICONE_TIPO = { 'ligação': 'phone', 'e-mail': 'envelope-simple', 'email': 'envelope-simple', 'whatsapp': 'whatsapp-logo', 'reunião': 'users-three',
  'visita': 'map-pin', 'mensagem': 'chats-circle', 'tarefa': 'check-square', 'proposta': 'file-text' };
// Célula de tabela por tipo de campo: [conteúdo, classe da célula]
export function celula(r, k, ty) {
  const v = r[k];
  if (v == null || v === '') return [h('span.vazio', '—'), ''];
  if (ty === 'money' || ty === 'number' || ty === 'percent') return [fmtField(v, ty), 'num'];
  if (ty === 'user') return [h('span.who', h('span.avatar.xs', initials(v)), String(v)), 'nw'];
  if (/_status$/.test(k) || ty === 'status') return [h(`span.badge.${TOM[String(v).toLowerCase()] || 'open'}`, String(v)), 'nw'];
  if (/last_contact/.test(k)) return [h('span', { title: dateTime(v) }, relativo(v)), 'nw'];
  if (ty === 'date') { const hm = String(v).slice(11, 16); return [hm && hm !== '00:00' ? h('span', date(v), h('span.hora', hm)) : date(v), 'nw']; }
  const ic = /_type$/.test(k) && ICONE_TIPO[String(v).toLowerCase()];
  if (ic) return [h('span.who', `ph:${ic} ${v}`), 'nw'];
  return [h('div.cl', { title: String(v).length > 60 ? String(v) : null }, String(v)), ''];
}
export function fmtField(v, type) {
  if (v == null || v === '') return '';
  if (type === 'money') return money(v);
  if (type === 'number') return num(v, 2);
  if (type === 'date') return String(v).length > 10 ? dateTime(v) : date(v);
  return String(v);
}
export const statusBadge = s => h(`span.badge.${s}`, { won: 'Ganho', lost: 'Perdido', open: 'Em andamento' }[s] || s);
export const docStatus = s => h(`span.badge.${s}`, { won: 'Ganha', lost: 'Perdida', open: 'Em aberto' }[s] || s);

// ---------- feedback ----------
export function toast(msg, err) {
  const t = h(`div.toast${err ? '.err' : ''}`, { role: err ? 'alert' : 'status' }, msg); $('#toasts').append(t); setTimeout(() => t.remove(), err ? 5000 : 2800);
}
// Executa uma ação com tratamento de erro; se veio de um botão, mostra "carregando" nele quando demora mais de 150ms
const emAndamento = new WeakSet();
export const guard = fn => async (...a) => {
  const b = a[0]?.currentTarget instanceof HTMLButtonElement ? a[0].currentTarget : null;
  if (b) { if (emAndamento.has(b)) return; emAndamento.add(b); } // ignora o 2º clique enquanto o 1º não termina
  const t = b && setTimeout(() => b.setAttribute('aria-busy', 'true'), 150);
  try { return await fn(...a); } catch (e) { toast(e.message, true); } finally { if (b) { clearTimeout(t); b.removeAttribute('aria-busy'); emAndamento.delete(b); } }
};

export function modal(title, body, { foot, size, onClose } = {}) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = e => { if (e.key === 'Escape' && document.querySelectorAll('.overlay').length && ov === [...document.querySelectorAll('.overlay')].pop()) close(); };
  const ov = h('div.overlay', { on: { mousedown: e => { if (e.target === ov) close(); } } },
    h(`div.modal${size ? '.' + size : ''}`, h('div.mh', h('h2', title), h('button.iconbtn', { title: 'Fechar', on: { click: close } }, '✕')),
      h('div.mb', body), foot ? h('div.mf', foot) : null));
  document.addEventListener('keydown', esc);
  document.body.append(ov);
  return { close, el: ov };
}
export function confirmDialog(msg, okLabel = 'Excluir') {
  return new Promise(res => {
    const m = modal('Confirmar', h('p', msg), { foot: [h('button.btn', { on: { click: () => { m.close(); res(false); } } }, 'Cancelar'), h('button.btn.pri', { on: { click: () => { m.close(); res(true); } } }, okLabel)] });
  });
}
export function promptDialog(title, value = '', label = 'Nome') {
  return new Promise(res => {
    const inp = h('input.i', { value, maxLength: 200 });
    const ok = () => { m.close(); res(inp.value.trim() || null); };
    inp.addEventListener('keydown', e => e.key === 'Enter' && ok());
    const m = modal(title, h('label.f', h('span', label), inp), { foot: [h('button.btn', { on: { click: () => { m.close(); res(null); } } }, 'Cancelar'), h('button.btn.pri', { on: { click: ok } }, 'Salvar')] });
    setTimeout(() => inp.focus(), 30);
  });
}
export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach(m => m.remove());
  const m = h('div.menu', items.filter(Boolean).map(it => it === '-' ? h('hr') : it.header ? h('div.mh', it.header) :
    h(`button${it.danger ? '.danger' : ''}`, { on: { click: () => { m.remove(); it.click(); } } }, h('span', it.icon || ''), it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, innerWidth - m.offsetWidth - 8), top = r.bottom + 4 + m.offsetHeight > innerHeight ? r.top - m.offsetHeight - 4 : r.bottom + 4;
  Object.assign(m.style, { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` });
  setTimeout(() => document.addEventListener('mousedown', function f(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', f); } }), 0);
}

// ---------- campos de formulário ----------
export function sel(options, value, { empty = '—', onchange } = {}) {
  const s = h('select.i', { on: onchange ? { change: e => onchange(e.target.value) } : null },
    empty !== null ? h('option', { value: '' }, empty) : null,
    options.map(o => h('option', { value: o.id ?? o.value ?? o, selected: String(o.id ?? o.value ?? o) === String(value ?? '') }, o.name ?? o.label ?? o)));
  return s;
}
export const field = (label, input, cls = '') => h(`label.f${cls}`, h('span', label), input);

/**
 * Formulário genérico. spec: [{ key, label, type: text|textarea|number|money|date|time|select|user|contact|deal|option:kind, required, span }]
 * Retorna { el, value() }
 */
export function form(spec, data = {}) {
  const inputs = {};
  const el = h('div.grid2');
  for (const s of spec) {
    let inp;
    const v = data[s.key] ?? s.default ?? '';
    if (s.type === 'textarea') inp = h('textarea.i', { value: v });
    else if (s.type === 'select') inp = sel(s.options, v, { empty: s.required ? null : '—' });
    else if (s.type === 'user') inp = sel(state.meta.users.filter(u => u.active), v || (s.required ? state.me.id : ''));
    else if (s.type?.startsWith('option:')) inp = sel(opts(s.type.slice(7)), v);
    else if (s.type === 'team') inp = sel(state.meta.teams, v);
    else if (s.type === 'pipeline') inp = sel(state.meta.pipelines.filter(p => !p.archived), v, { empty: null });
    else if (s.type === 'contact' || s.type === 'deal' || s.type === 'company') inp = lookup(s.type, v, data[`${s.key}_label`]);
    else inp = h('input.i', { type: { number: 'number', money: 'number', date: 'date', time: 'time', email: 'email' }[s.type] || 'text', value: s.type === 'date' ? String(v).slice(0, 10) : v, step: s.type === 'money' ? '0.01' : null, maxLength: s.max || null });
    inputs[s.key] = inp;
    const lab = h('label.f', h('span', s.label, s.required ? ' *' : ''), inp);
    if (s.span) lab.classList.add('span2');
    el.append(lab);
  }
  return {
    el, inputs,
    value() {
      const o = {};
      for (const s of spec) {
        const i = inputs[s.key]; let v = i.getValue ? i.getValue() : i.value;
        if (['number', 'money'].includes(s.type)) v = v === '' ? null : Number(v);
        else if (v === '') v = null;
        if (s.required && (v == null || v === '')) throw new Error(`Preencha: ${s.label}`);
        o[s.key] = v;
      }
      return o;
    },
  };
}

// Campo de busca (cliente/negócio) com lista
let cache = {};
export async function rowsOf(entity, force) { if (force || !cache[entity]) cache[entity] = api(`/rows/${entity}`); return cache[entity]; }
export const invalidate = (...e) => { if (!e.length) cache = {}; else e.forEach(x => delete cache[x]); };
export function lookup(kind, value, label) {
  const ent = kind === 'deal' ? 'deal' : 'contact';
  const idF = ENTITIES[ent].idField, nameF = kind === 'deal' ? 'deal_title' : 'contact_name';
  const wrap = h('div', { style: { position: 'relative' } });
  const inp = h('input.i', { placeholder: 'Digite para buscar…', value: label || '' });
  const list = h('div.menu.hidden', { style: { position: 'absolute', top: '36px', left: 0, right: 0, maxHeight: '240px', overflow: 'auto' } });
  wrap.dataset.id = value || '';
  if (value && !label) rowsOf(ent).then(rs => { const r = rs.find(x => x[idF] === +value); if (r) inp.value = r[nameF]; });
  inp.addEventListener('input', async () => {
    wrap.dataset.id = '';
    const q = inp.value.toLowerCase(); const rs = await rowsOf(ent);
    clear(list).classList.toggle('hidden', !q);
    rs.filter(r => (kind !== 'company' || r.contact_type === 'Empresa') && String(r[nameF]).toLowerCase().includes(q)).slice(0, 12)
      .forEach(r => list.append(h('button', { type: 'button', on: { mousedown: e => { e.preventDefault(); wrap.dataset.id = r[idF]; inp.value = r[nameF]; list.classList.add('hidden'); wrap.dispatchEvent(new Event('change')); } } }, r[nameF], kind === 'deal' ? h('small.muted', ` · ${r.contact_name || ''}`) : '')));
  });
  inp.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
  wrap.append(inp, list);
  wrap.getValue = () => (wrap.dataset.id ? Number(wrap.dataset.id) : null);
  return wrap;
}

// ---------- construtor de filtro avançado ----------
/** entity: chave de ENTITIES; filter: {conditions:[]}; retorna { el, value() } */
export function filterBuilder(entity, filter = { conditions: [] }) {
  const ent = ENTITIES[entity];
  let conds = JSON.parse(JSON.stringify(filter?.conditions || []));
  const el = h('div');
  const valuesFor = async (fieldKey) => { const rs = await rowsOf(entity); return [...new Set(rs.map(r => r[fieldKey]).filter(v => v != null && v !== ''))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR')); };
  function valueInput(c) {
    const f = ent.fieldMap[c.field]; if (!f) return h('span');
    const op = +c.op;
    if (op === 10 || op === 11) return h('span.muted.small', '—');
    if (f.type === 'date') {
      const mode = sel([{ id: 'abs', name: 'Data fixa' }, ...RELATIVE_DATES.map(r => ({ id: r.id, name: r.label }))], c.rel?.id || 'abs', { empty: null, onchange: v => { c.rel = v === 'abs' ? null : { id: v, n: c.rel?.n || 6 }; draw(); } });
      const box = h('div.row', mode);
      if (c.rel?.id) { if (RELATIVE_DATES.find(r => r.id === c.rel.id)?.n) box.append(h('input.i', { type: 'number', min: 1, value: c.rel.n || 1, style: { width: '70px' }, on: { input: e => { c.rel.n = +e.target.value; } } })); }
      else {
        box.append(h('input.i', { type: 'date', value: c.value || '', on: { input: e => { c.value = e.target.value; } } }));
        if (op === 9) box.append(h('input.i', { type: 'date', value: c.value2 || '', on: { input: e => { c.value2 = e.target.value; } } }));
      }
      return box;
    }
    if (NUMERIC.has(f.type)) {
      const box = h('div.row', h('input.i', { type: 'number', value: c.value ?? '', on: { input: e => { c.value = e.target.value; } } }));
      if (op === 9) box.append(h('input.i', { type: 'number', value: c.value2 ?? '', on: { input: e => { c.value2 = e.target.value; } } }));
      return box;
    }
    if (f.type === 'text' || op === 7 || op === 8) return h('input.i', { value: Array.isArray(c.value) ? c.value.join(', ') : c.value || '', on: { input: e => { c.value = e.target.value; } } });
    // seleção múltipla de valores existentes
    const vals = Array.isArray(c.value) ? c.value : c.value ? [c.value] : [];
    c.value = vals;
    const box = h('div.multi');
    const redraw = async () => {
      clear(box);
      vals.forEach((v, i) => box.append(h('span.chip', v, h('b', { on: { click: () => { vals.splice(i, 1); redraw(); } } }, '×'))));
      const s = h('select', { on: { change: e => { if (e.target.value) { vals.push(e.target.value); redraw(); } } } }, h('option', { value: '' }, vals.length ? '+ adicionar' : 'Selecione…'));
      (await valuesFor(c.field)).filter(v => !vals.includes(String(v))).forEach(v => s.append(h('option', { value: v }, v)));
      box.append(s);
    };
    redraw();
    return box;
  }
  function draw() {
    clear(el);
    const groups = [...new Set(conds.map(c => c.group || 1))].sort((a, b) => a - b);
    if (!groups.length) groups.push(1);
    groups.forEach((g, gi) => {
      if (gi) el.append(h('div.or', 'OU'));
      const box = h('div.fgroup', h('div.gl', `Grupo ${gi + 1} — todas as condições (E)`));
      conds.filter(c => (c.group || 1) === g).forEach(c => {
        const f = ent.fieldMap[c.field];
        const fieldSel = sel(ent.fields.map(([k, l]) => ({ id: k, name: l })), c.field, { empty: 'Selecione um campo', onchange: v => { c.field = v; c.op = operatorsFor(ent.fieldMap[v]?.type)[0]; c.value = null; c.value2 = null; c.rel = ent.fieldMap[v]?.type === 'date' ? { id: 'thismonth' } : null; draw(); } });
        const opSel = f ? sel(OPERATORS.filter(o => operatorsFor(f.type).includes(o.id)).map(o => ({ id: o.id, name: f.type === 'date' && c.rel?.id && o.id === 1 ? 'Está em' : o.label })), c.op, { empty: null, onchange: v => { c.op = +v; draw(); } }) : h('span');
        box.append(h('div.fcond', fieldSel, opSel, valueInput(c), h('button.iconbtn', { type: 'button', title: 'Remover', on: { click: () => { conds.splice(conds.indexOf(c), 1); draw(); } } }, '✕')));
      });
      box.append(h('button.btn.sm.ghost', { type: 'button', on: { click: () => { conds.push({ field: '', op: 1, group: g }); draw(); } } }, '+ Condição'));
      el.append(box);
    });
    el.append(h('button.btn.sm', { type: 'button', on: { click: () => { const g = Math.max(0, ...conds.map(c => c.group || 1)) + 1; conds.push({ field: '', op: 1, group: g }); draw(); } } }, '+ Grupo (OU)'));
  }
  draw();
  return { el, value: () => ({ conditions: conds.filter(c => c.field) }) };
}

// ---------- lista genérica com abas, busca, ordenação, paginação ----------
/**
 * opts: { module, entity, columns:[[key,label,type?]], tabsDefault:[{name, filter}], onOpen(row), searchKeys, extraFilter(row) }
 */
export async function dataList(container, o) {
  const ent = ENTITIES[o.entity];
  let tabs = await api(`/t/tabs?module=${o.module}`);
  if (!tabs.length && o.tabsDefault) {
    for (const [i, t] of o.tabsDefault.entries()) await api('/t/tabs', { body: { module: o.module, name: t.name, filter: t.filter, ord: i } });
    tabs = await api(`/t/tabs?module=${o.module}`);
  }
  const st = { tab: tabs[0]?.id || null, q: '', sort: o.sort || null, asc: false, page: 0, per: 25, adv: null };
  try { Object.assign(st, JSON.parse(sessionStorage.getItem(`list-${o.module}`) || '{}')); } catch {}
  if (!tabs.find(t => t.id === st.tab)) st.tab = tabs[0]?.id || null;
  const persist = () => { try { sessionStorage.setItem(`list-${o.module}`, JSON.stringify({ tab: st.tab, sort: st.sort, asc: st.asc, q: st.q })); } catch {} };
  let rows = [];
  const bar = h('div.tabsbar'), tools = h('div.row.wrap', { style: { marginBottom: '10px' } }), body = h('div');
  container.append(bar, tools, body);
  const search = h('input.i', { placeholder: o.searchPlaceholder || 'Buscar…', value: st.q, style: { maxWidth: '280px' }, on: { input: e => { st.q = e.target.value; st.page = 0; persist(); renderTable(); } } });
  const advBtn = h('button.btn', { on: { click: () => openAdv() } }, '⚲ Filtros');
  const rotuloFiltro = () => advBtn.replaceChildren(...(glyphNodes(st.adv?.conditions.length ? `⚲ Filtros (${st.adv.conditions.length})` : '⚲ Filtros') || []));
  tools.append(search, advBtn, h('span.grow'), h('span.muted.small.count'), h('button.btn', { title: 'Exportar CSV', on: { click: () => exportCsv() } }, '⇩ CSV'));

  function drawTabs() {
    clear(bar);
    tabs.forEach(t => bar.append(h(`span.tab${t.id === st.tab ? '.on' : ''}`, { on: { click: () => { st.tab = t.id; st.page = 0; persist(); drawTabs(); renderTable(); } } }, t.name,
      h('span.x', { title: 'Opções da aba', on: { click: e => { e.stopPropagation(); menu(e.target, [
        { label: 'Editar aba', icon: '✎', click: () => tabEditor(t) },
        { label: 'Excluir aba', icon: '🗑', danger: true, click: guard(async () => { if (await confirmDialog(`Excluir a aba "${t.name}"?`)) { await del('tabs', t.id); tabs = tabs.filter(x => x.id !== t.id); st.tab = tabs[0]?.id; drawTabs(); renderTable(); } }) }]); } } }, '⋯'))));
    bar.append(h('button.btn.sm.ghost', { on: { click: () => tabEditor() } }, '+ Nova aba'));
  }
  function tabEditor(t = {}) {
    const name = h('input.i', { value: t.name || '', maxLength: 150 });
    const per = sel([10, 25, 50, 100].map(n => ({ id: n, name: `${n} itens` })), t.per_page || 25, { empty: null });
    const fb = filterBuilder(o.entity, typeof t.filter === 'string' ? JSON.parse(t.filter || '{}') : t.filter);
    const m = modal(t.id ? 'Editar aba' : 'Nova aba', h('div.col', field('Nome da aba', name), field('Itens por página', per), h('b', 'Filtros da aba'), fb.el), {
      size: 'mid', foot: [h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => {
        if (!name.value.trim()) throw new Error('Informe o nome da aba');
        const r = await save('tabs', { id: t.id, module: o.module, name: name.value.trim(), per_page: +per.value, filter: JSON.stringify(fb.value()), ord: t.ord ?? tabs.length });
        tabs = await api(`/t/tabs?module=${o.module}`); st.tab = r.id; m.close(); drawTabs(); renderTable();
      }) } }, t.id ? 'Salvar' : 'Criar aba')] });
  }
  function openAdv() {
    const fb = filterBuilder(o.entity, st.adv || { conditions: [] });
    const m = modal('Filtro avançado', fb.el, { size: 'mid', foot: [
      h('button.btn', { on: { click: () => { st.adv = null; rotuloFiltro(); m.close(); renderTable(); } } }, 'Limpar'),
      h('button.btn.pri', { on: { click: () => { st.adv = fb.value(); rotuloFiltro(); m.close(); st.page = 0; renderTable(); } } }, 'Aplicar')] });
  }
  function filtered() {
    const tab = tabs.find(t => t.id === st.tab);
    const tf = tab?.filter ? JSON.parse(tab.filter) : null;
    const q = st.q.toLowerCase().trim();
    let list = rows.filter(r => (!tf || matchFilter(r, tf, ent.fieldMap)) && (!st.adv || matchFilter(r, st.adv, ent.fieldMap)) && (!o.extraFilter || o.extraFilter(r)));
    if (q) list = list.filter(r => (o.searchKeys || o.columns.map(c => c[0])).some(k => String(r[k] ?? '').toLowerCase().includes(q)));
    if (st.sort) {
      const t = ent.fieldMap[st.sort]?.type;
      list.sort((a, b) => { const x = a[st.sort], y = b[st.sort]; const c = NUMERIC.has(t) ? (x || 0) - (y || 0) : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR'); return st.asc ? c : -c; });
    }
    return list;
  }
  function renderTable() {
    const list = filtered(); const per = tabs.find(t => t.id === st.tab)?.per_page || 25;
    const pages = Math.max(1, Math.ceil(list.length / per)); st.page = Math.min(st.page, pages - 1);
    tools.querySelector('.count').textContent = `${list.length} ${list.length === 1 ? 'item' : 'itens'}`;
    clear(body);
    if (!list.length) {
      const filtrando = st.q.trim() || st.adv?.conditions.length;
      return body.append(h('div.tablewrap', h('div.empty', filtrando ? [`Nada encontrado${st.q.trim() ? ` para “${st.q.trim()}”` : ''} com os filtros atuais.`,
        h('div', { style: { marginTop: '12px' } }, h('button.btn.sm', { on: { click: () => { st.q = ''; search.value = ''; st.adv = null; rotuloFiltro(); persist(); renderTable(); } } }, 'Limpar busca e filtros'))]
        : (o.emptyText || 'Nenhum registro nesta aba ainda.'))));
    }
    const cols = o.columns;
    body.append(h('div.tablewrap', h('table.t',
      h('thead', h('tr', cols.map(([k, l, t]) => h(`th${NUMERIC.has(t || ent.fieldMap[k]?.type) ? '.num' : ''}`, { on: { click: () => { st.asc = st.sort === k ? !st.asc : true; st.sort = k; persist(); renderTable(); } } }, l, st.sort === k ? (st.asc ? ' ▲' : ' ▼') : '')))),
      h('tbody', list.slice(st.page * per, st.page * per + per).map(r => h('tr.click', { on: { click: () => o.onOpen?.(r) } },
        cols.map(([k, , t, render], i) => { const ty = t || ent.fieldMap[k]?.type; if (render) return h('td', render(r));
          const [c, cls] = celula(r, k, ty); return h(`td${cls ? '.' + cls : ''}${i === 0 ? '.pri' : ''}`, c); })))))),
      pages > 1 ? h('div.pager', h('span.muted', `${st.page * per + 1}–${Math.min(list.length, st.page * per + per)} de ${list.length}`), h('span.grow'),
        h('button.iconbtn', { 'aria-label': 'Página anterior', title: 'Página anterior', disabled: st.page === 0, on: { click: () => { st.page--; renderTable(); } } }, 'ph:caret-left'),
        h('span.small', `Página ${st.page + 1} de ${pages}`),
        h('button.iconbtn', { 'aria-label': 'Próxima página', title: 'Próxima página', disabled: st.page >= pages - 1, on: { click: () => { st.page++; renderTable(); } } }, 'ph:caret-right')) : '');
  }
  function exportCsv() {
    const list = filtered();
    const csv = csvLinhas([o.columns.map(c => c[1]), ...list.map(r => o.columns.map(([k]) => r[k] ?? ''))]);
    download(`${o.module}.csv`, '﻿' + csv, 'text/csv');
  }
  async function reload(force = true) { rows = await rowsOf(o.entity, force); renderTable(); }
  drawTabs();
  await reload(false);
  return { reload };
}

export function download(name, content, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
