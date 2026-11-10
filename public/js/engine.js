// Motor de filtros e agregação (puro, sem dependências) — usado no servidor e no navegador.
import { ENTITIES, NUMERIC, chartType } from './schema.js';

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); return x; };
const startOfWeek = d => addDays(d, -d.getDay());
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfPeriod = (d, months) => new Date(d.getFullYear(), Math.floor(d.getMonth() / months) * months, 1);

export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

// Retorna [início, fim] (strings YYYY-MM-DD, inclusivas) para uma data relativa
export function resolveRelative(id, n = 1, now = new Date()) {
  n = Math.max(1, parseInt(n, 10) || 1);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const per = (months, offset, count = 1) => {
    const s = addMonths(startOfPeriod(t, months), offset * months);
    const e = addDays(addMonths(s, months * count), -1);
    return [s, e];
  };
  let r;
  switch (id) {
    case 'today': r = [t, t]; break;
    case 'yesterday': r = [addDays(t, -1), addDays(t, -1)]; break;
    case 'thisweek': r = [startOfWeek(t), addDays(startOfWeek(t), 6)]; break;
    case 'last7days': r = [addDays(t, -6), t]; break;
    case 'lastweek': r = [addDays(startOfWeek(t), -7), addDays(startOfWeek(t), -1)]; break;
    case 'thismonth': r = [startOfMonth(t), endOfMonth(t)]; break;
    case 'last30days': r = [addDays(t, -29), t]; break;
    case 'lastmonth': r = [addMonths(t, -1), addDays(startOfMonth(t), -1)]; break;
    case 'lastndays': r = [addDays(t, -(n - 1)), t]; break;
    case 'lastnweeks': r = [addDays(t, -7 * n + 1), t]; break;
    case 'lastnmonths': r = [addMonths(t, -(n - 1)), t]; break; // mês atual + N-1 anteriores
    case 'nextndays': r = [t, addDays(t, n - 1)]; break;
    case 'nextnweeks': r = [t, addDays(t, 7 * n - 1)]; break;
    case 'nextnmonths': r = [t, endOfMonth(addMonths(t, n - 1))]; break;
    case 'thisyear': r = per(12, 0); break;
    case 'lastyear': r = per(12, -1); break;
    case 'thisquarter': r = per(3, 0); break;
    case 'thissemester': r = per(6, 0); break;
    case 'lastnquarters': r = [per(3, -(n - 1))[0], per(3, 0)[1]]; break;
    case 'lastnsemesters': r = [per(6, -(n - 1))[0], per(6, 0)[1]]; break;
    case 'nextnquarters': r = [per(3, 0)[0], per(3, n - 1)[1]]; break;
    case 'nextnsemesters': r = [per(6, 0)[0], per(6, n - 1)[1]]; break;
    case 'lastnyears': r = [per(12, -(n - 1))[0], per(12, 0)[1]]; break;
    case 'nextnyears': r = [per(12, 0)[0], per(12, n - 1)[1]]; break;
    case 'ndaysago': r = [addDays(t, -n), addDays(t, -n)]; break;
    case 'nweeksago': { const s = addDays(startOfWeek(t), -7 * n); r = [s, addDays(s, 6)]; break; }
    case 'nmonthsago': { const s = addMonths(t, -n); r = [s, endOfMonth(s)]; break; }
    case 'nquartersago': r = per(3, -n); break;
    case 'nsemestersago': r = per(6, -n); break;
    case 'nyearsago': r = per(12, -n); break;
    case 'lastquarter': r = per(3, -1); break;
    case 'lastsemester': r = per(6, -1); break;
    default: r = [t, t];
  }
  return [ymd(r[0]), ymd(r[1])];
}

const norm = v => (v == null ? '' : String(v)).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
const isEmpty = v => v == null || v === '';

// cond: { field, op, value, value2, rel:{id,n}, group }
export function matchCondition(row, cond, type) {
  const raw = row[cond.field];
  const op = +cond.op;
  if (op === 10) return isEmpty(raw);
  if (op === 11) return !isEmpty(raw);
  if (type === 'date') {
    const d = raw ? String(raw).slice(0, 10) : '';
    if (!d) return false;
    let a = cond.value, b = cond.value2;
    if (cond.rel?.id) [a, b] = resolveRelative(cond.rel.id, cond.rel.n);
    else if (op === 1 || op === 2) b = a;
    switch (op) {
      case 1: case 9: return d >= a && d <= b;
      case 2: return !(d >= a && d <= b);
      case 3: return d > b; case 4: return d >= a; case 5: return d < a; case 6: return d <= b;
      default: return true;
    }
  }
  if (NUMERIC.has(type)) {
    const x = Number(raw), a = Number(cond.value), b = Number(cond.value2);
    switch (op) {
      case 1: return x === a; case 2: return x !== a; case 3: return x > a; case 4: return x >= a;
      case 5: return x < a; case 6: return x <= a; case 9: return x >= a && x <= b;
      default: return true;
    }
  }
  const vals = Array.isArray(cond.value) ? cond.value : [cond.value];
  const x = norm(raw);
  switch (op) {
    case 1: return vals.some(v => norm(v) === x);
    case 2: return !vals.some(v => norm(v) === x);
    case 7: return vals.some(v => x.includes(norm(v)));
    case 8: return !vals.some(v => x.includes(norm(v)));
    default: return true;
  }
}

// filter: { conditions:[...] } — mesma "group" = E; grupos diferentes = OU
export function matchFilter(row, filter, fieldMap) {
  const conds = filter?.conditions?.filter(c => c.field) || [];
  if (!conds.length) return true;
  const groups = {};
  for (const c of conds) (groups[c.group || 1] ||= []).push(c);
  return Object.values(groups).some(g => g.every(c => matchCondition(row, c, fieldMap[c.field]?.type)));
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Converte um valor de data em "balde": { key, label, sort }
export function bucket(value, modifier) {
  const d = parseDate(value);
  if (!d) return { key: '(vazio)', label: '(vazio)', sort: 'zzz' };
  const y = d.getFullYear(), m = d.getMonth();
  const period = (months, name) => {
    const i = Math.floor(m / months) + 1;
    return { key: `${y}-${name}${i}`, label: `${i}º ${name === 'B' ? 'bim' : name === 'T' ? 'tri' : name === 'Q' ? 'quad' : 'sem'}/${String(y).slice(2)}`, sort: `${y}-${pad(i)}` };
  };
  switch (modifier) {
    case 'week': { const s = startOfWeek(d); return { key: ymd(s), label: `Sem ${pad(s.getDate())}/${pad(s.getMonth() + 1)}`, sort: ymd(s) }; }
    case 'weekday': return { key: String(d.getDay()), label: WEEKDAYS[d.getDay()], sort: String(d.getDay()) };
    case 'month': return { key: `${y}-${pad(m + 1)}`, label: `${MONTHS[m]}/${String(y).slice(2)}`, sort: `${y}-${pad(m + 1)}` };
    case 'bimester': return period(2, 'B');
    case 'quarter': return period(3, 'T');
    case 'quadrimester': return period(4, 'Q');
    case 'semester': return period(6, 'S');
    case 'year': return { key: String(y), label: String(y), sort: String(y) };
    case 'hour': return { key: pad(d.getHours()), label: `${pad(d.getHours())}h`, sort: pad(d.getHours()) };
    default: return { key: ymd(d), label: `${pad(d.getDate())}/${pad(m + 1)}/${String(y).slice(2)}`, sort: ymd(d) };
  }
}

// Preenche lacunas entre o primeiro e o último balde de data
function fillGaps(keys, modifier) {
  if (!keys.length) return keys;
  if (modifier === 'weekday') return ['0', '1', '2', '3', '4', '5', '6'];
  if (modifier === 'hour') return Array.from({ length: 24 }, (_, i) => pad(i));
  const step = { day: d => addDays(d, 1), week: d => addDays(d, 7), month: d => addMonths(d, 1), year: d => addMonths(d, 12) }[modifier || 'day'];
  if (!step) return keys;
  const real = keys.filter(k => k !== '(vazio)').sort();
  if (real.length < 2) return keys;
  const toDate = k => modifier === 'year' ? new Date(+k, 0, 1) : modifier === 'month' ? new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1) : parseDate(k);
  const out = []; let d = toDate(real[0]); const end = toDate(real[real.length - 1]);
  let guard = 0;
  while (d <= end && guard++ < 2000) { out.push(bucket(d, modifier).key); d = step(d); }
  return keys.includes('(vazio)') ? [...out, '(vazio)'] : out;
}

export function aggregate(values, agg) {
  if (agg === 'count') return values.length;
  const nums = values.map(Number).filter(v => !Number.isNaN(v));
  if (!nums.length) return 0;
  if (agg === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (agg === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (agg === 'max') return Math.max(...nums);
  if (agg === 'min') return Math.min(...nums);
  return nums.length;
}

// Converte os filtros ativos do painel em condições extras para uma métrica
export function panelConditions(metric, panelFilters = []) {
  const out = [];
  for (const pf of panelFilters) {
    if (!pf.active) continue;
    const field = pf.map?.[metric.id];
    if (!field) continue;
    const v = pf.value || {};
    if (pf.type === 'date') {
      if (v.rel?.id) out.push({ field, op: 1, rel: v.rel });
      else if (v.from || v.to) out.push({ field, op: 9, value: v.from || '0000-01-01', value2: v.to || '9999-12-31' });
    } else if (pf.type === 'number') {
      if (v.min !== undefined && v.min !== '') out.push({ field, op: 4, value: v.min });
      if (v.max !== undefined && v.max !== '') out.push({ field, op: 6, value: v.max });
    } else if (pf.type === 'text') {
      if (v.text) out.push({ field, op: 7, value: v.text });
    } else if (Array.isArray(v.values) && v.values.length) {
      out.push({ field, op: 1, value: v.values });
    }
  }
  return out;
}

// Filtra as linhas de uma métrica (filtro próprio + filtros de painel)
export function metricRows(metric, rows, panelFilters) {
  const ent = ENTITIES[metric.entity];
  const extra = panelConditions(metric, panelFilters);
  return rows.filter(r => matchFilter(r, metric.filter, ent.fieldMap) && extra.every(c => matchCondition(r, c, ent.fieldMap[c.field]?.type)));
}

/**
 * Calcula um gráfico.
 * chart: { type, metric_limit, order_desc }, metrics: [{ id, entity, name, aggregator, field, color, visible, filter, dims:[{field,modifier}] }]
 * rowsByEntity: { entity: rows[] }
 */
export function compute(chart, metrics, rowsByEntity, panelFilters = []) {
  const type = chartType(chart.type);
  const vis = metrics.filter(m => m.visible !== false && m.visible !== 0);
  const out = { type: chart.type, labels: [], keys: [], series: [], rows: [], total: 0 };
  if (!vis.length) return out;

  const per = vis.map(m => {
    const ent = ENTITIES[m.entity];
    const rows = metricRows(m, rowsByEntity[m.entity] || [], panelFilters);
    const valueOf = r => (m.aggregator === 'count' ? r[ent.idField] : r[m.field]);
    let dims = (m.dims || []).filter(d => d.field).slice(0, type?.maxD ?? 1);
    if (type?.forceDim && !dims.length) dims = [{ field: Object.keys(ent.fieldMap).find(k => ent.fieldMap[k].type === 'state') }];
    const groups = new Map();
    for (const r of rows) {
      const parts = dims.map(d => {
        const f = ent.fieldMap[d.field];
        if (f?.type === 'date') return bucket(r[d.field], d.modifier || 'day');
        const v = isEmpty(r[d.field]) ? '(vazio)' : String(r[d.field]);
        return { key: v, label: v, sort: v };
      });
      const key = parts.map(p => p.key).join('␟');
      if (!groups.has(key)) groups.set(key, { parts, vals: [], rows: [] });
      const g = groups.get(key); g.vals.push(valueOf(r));
    }
    const agg = new Map([...groups].map(([k, g]) => [k, { parts: g.parts, value: aggregate(g.vals, m.aggregator) }]));
    return { m, dims, ent, agg, all: aggregate(rows.map(valueOf), m.aggregator), count: rows.length };
  });

  const first = per[0];
  if (chart.type === 'indicator' || !first.dims.length) {
    out.series = per.map(p => ({ metricId: p.m.id, name: p.m.name, color: p.m.color, data: [p.all], total: p.all }));
    out.value = first.all; out.total = first.all;
    return out;
  }

  // Dimensão principal: união das chaves
  const meta = new Map();
  for (const p of per) for (const [k, a] of p.agg) {
    const k1 = a.parts[0].key;
    if (!meta.has(k1)) meta.set(k1, a.parts[0]);
  }
  const d0 = first.dims[0];
  const isDate = first.ent.fieldMap[d0.field]?.type === 'date';
  let keys;
  if (isDate) {
    keys = fillGaps([...meta.keys()], d0.modifier || 'day');
    for (const k of keys) if (!meta.has(k)) meta.set(k, { key: k, label: bucketLabelFromKey(k, d0.modifier || 'day'), sort: k });
    keys.sort((a, b) => (meta.get(a).sort > meta.get(b).sort ? 1 : -1));
  } else {
    const total1 = k => [...first.agg].filter(([kk]) => kk.split('␟')[0] === k).reduce((s, [, a]) => s + a.value, 0);
    keys = [...meta.keys()].sort((a, b) => (chart.order_asc ? total1(a) - total1(b) : total1(b) - total1(a)));
    const lim = +chart.metric_limit;
    if (lim > 0 && keys.length > lim) keys = keys.slice(0, lim);
  }
  out.keys = keys;
  out.labels = keys.map(k => meta.get(k).label);

  if (chart.type === 'table' && first.dims.length === 2) {
    // Tabela com 2 dimensões: linhas = dim1, colunas = dim2 (por métrica)
    const cols = [...new Set([...first.agg.values()].map(a => a.parts[1].key))].sort();
    out.pivot = { cols, colLabels: cols.map(c => [...first.agg.values()].find(a => a.parts[1].key === c).parts[1].label) };
    out.rows = keys.map(k => ({ key: k, label: meta.get(k).label, cells: cols.map(c => first.agg.get(`${k}␟${c}`)?.value || 0) }));
    out.series = [{ metricId: first.m.id, name: first.m.name, color: first.m.color, total: first.all }];
    out.total = first.all;
    return out;
  }

  out.series = per.map(p => {
    const byKey = new Map();
    for (const [, a] of p.agg) byKey.set(a.parts[0].key, (byKey.get(a.parts[0].key) || 0) + a.value);
    return { metricId: p.m.id, name: p.m.name, color: p.m.color, data: keys.map(k => byKey.get(k) || 0), total: p.all };
  });
  out.total = out.series[0]?.total || 0;
  return out;
}

function bucketLabelFromKey(k, modifier) {
  if (modifier === 'month') return bucket(`${k}-01`, 'month').label;
  if (modifier === 'year') return k;
  if (modifier === 'weekday') return WEEKDAYS[+k];
  if (modifier === 'hour') return `${k}h`;
  return bucket(k, modifier).label;
}

// Linhas por trás de um ponto do gráfico (drill-down)
export function drillRows(metric, rows, panelFilters, keys = []) {
  const ent = ENTITIES[metric.entity];
  const base = metricRows(metric, rows, panelFilters);
  const dims = (metric.dims || []).filter(d => d.field);
  return base.filter(r => dims.every((d, i) => {
    if (keys[i] === undefined || keys[i] === null) return true;
    const f = ent.fieldMap[d.field];
    const k = f?.type === 'date' ? bucket(r[d.field], d.modifier || 'day').key : (isEmpty(r[d.field]) ? '(vazio)' : String(r[d.field]));
    return k === keys[i];
  }));
}
