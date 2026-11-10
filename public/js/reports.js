// Módulo de Relatórios: painéis, gráficos, editor, filtros de painel, drill-down e apresentação.
import { h, icon, $, clear, api, state, money, num, compact, date, fmtField, toast, guard, modal, confirmDialog, promptDialog, menu, sel, field, filterBuilder, download, rowsOf, csvCell, csvLinhas } from './ui.js';
import { VIEWBOX, ESTADOS } from './brasil-mapa.js';
import { ENTITIES, AGGREGATORS, MODIFIERS, CHART_TYPES, chartType, PANEL_FILTER_TYPES, RELATIVE_DATES, PALETTE, UFS, NUMERIC } from './schema.js';

const charts = new Map(); // id -> Chart.js instance
const killChart = id => { charts.get(id)?.destroy(); charts.delete(id); };
// Texto legível sobre uma cor de fundo (azul-marinho em fundos claros, branco em escuros)
const textOn = hex => { const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16); const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255]; return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#14213d' : '#ffffff'; };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const isMoneyMetric = m => m && m.aggregator !== 'count' && ENTITIES[m.entity]?.fieldMap[m.field]?.type === 'money';
const fmtVal = (v, m) => (isMoneyMetric(m) ? money(v) : num(v, m?.aggregator === 'avg' ? 2 : 2));
const ageLabel = at => { if (!at) return ''; const min = Math.round((Date.now() - new Date(at.replace(' ', 'T')).getTime()) / 60000); return min < 1 ? 'agora' : min < 60 ? `${min} min` : `${Math.round(min / 60)} h`; };

let ctx = { panelId: null, panel: null, charts: [], filters: [], content: null, hidePanels: false };

export async function reportsPage(content, panelId) {
  for (const id of [...charts.keys()]) killChart(id);
  ctx.content = content;
  const panels = await api('/reports/panels');
  if (!panelId && panels.length) { let last = null; try { last = +localStorage.getItem('lente-painel'); } catch {} location.replace(`#/relatorios/${panels.find(p => p.id === last)?.id || panels[0].id}`); return; }
  ctx.panelId = +panelId || null;
  try { localStorage.setItem('lente-painel', ctx.panelId); } catch {}
  try { ctx.hidePanels = localStorage.getItem('lente-paineis-min') === '1'; } catch {}
  const list = h('div.pl');
  const side = h(`div.panels${ctx.hidePanels ? '.min' : ''}`, h('div.ph', h('b.grow', 'Painéis'), h('button.iconbtn', { title: 'Novo painel', 'aria-label': 'Novo painel', on: { click: newPanel } }, '+')), list);
  const drawList = (q = '') => { clear(list); panels.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).forEach(p => list.append(h(`div.pi${p.id === ctx.panelId ? '.on' : ''}`, { on: { click: () => { location.hash = `#/relatorios/${p.id}`; } } },
    h('span', { title: p.name }, p.name), h('small.muted', p.charts), h('button.iconbtn', { title: 'Opções do painel', on: { click: e => { e.stopPropagation(); panelMenu(e.currentTarget, p); } } }, '⋯')))); };
  side.querySelector('.ph').after(h('div', { style: { padding: '8px 8px 0' } }, h('input.i', { placeholder: 'Buscar painel', on: { input: e => drawList(e.target.value) } })));
  drawList();
  const body = h('div.body');
  content.append(h('div.rep', side, body));
  if (!ctx.panelId) { body.append(h('div.empty', 'Ainda não há painéis. Crie um painel e adicione os gráficos que a equipe acompanha toda semana.', h('button.btn.pri', { on: { click: newPanel } }, '+ Criar painel'))); return; }
  const data = await api(`/reports/panel/${ctx.panelId}`);
  ctx.panel = data.panel; ctx.charts = data.charts; ctx.filters = data.filters;
  const activeCount = () => ctx.filters.filter(f => f.active).length;
  const filtBtn = h('button.btn', { on: { click: () => toggleFilters() } });
  const setFiltLabel = () => { filtBtn.replaceChildren(icon('funnel-simple'), activeCount() ? `Filtros · ${activeCount()}` : 'Filtros'); };
  setFiltLabel();
  const bar = h('div.bar',
    h('button.iconbtn', { title: 'Mostrar/ocultar painéis', 'aria-label': 'Mostrar ou ocultar a lista de painéis', on: { click: () => { side.classList.toggle('min'); try { localStorage.setItem('lente-paineis-min', side.classList.contains('min') ? '1' : '0'); } catch {} } } }, '☰'),
    h('span.title', h('b', ctx.panel.name)),
    filtBtn,
    h('button.btn', { title: 'Atualizar todos os gráficos', on: { click: () => drawGrid(true) } }, '⟳ Atualizar'),
    h('button.btn', { on: { click: () => present(0) } }, 'ph:play Apresentar'),
    h('button.btn.pri', { on: { click: () => chartEditor({ panel_id: ctx.panelId }) } }, '+ Gráfico'));
  const grid = h('div.cgrid'); const drawerSlot = h('div');
  body.append(bar, h('div.scroll', grid, drawerSlot));
  ctx.grid = grid; ctx.drawerSlot = drawerSlot; ctx.setFiltLabel = setFiltLabel;
  drawGrid(false);
  if (ctx.filtersOpen) toggleFilters(true);
  window.removeEventListener('themechange', onTheme); window.addEventListener('themechange', onTheme);
}
function onTheme() { if (ctx.grid?.isConnected) drawGrid(false); }

// ---------- painéis ----------
const newPanel = guard(async () => { const n = await promptDialog('Novo painel', '', 'Nome do painel'); if (!n) return; const r = await api('/t/report_panels', { body: { name: n, ord: 99 } }); location.hash = `#/relatorios/${r.id}`; });
function panelMenu(anchor, p) {
  menu(anchor, [
    { label: 'Renomear', icon: '✎', click: guard(async () => { const n = await promptDialog('Renomear painel', p.name); if (n) { await api(`/t/report_panels/${p.id}`, { method: 'PUT', body: { name: n } }); window.dispatchEvent(new Event('lente:refresh')); } }) },
    { label: 'Duplicar', icon: '⧉', click: guard(async () => { const r = await api(`/reports/panel/${p.id}/duplicate`, { body: {} }); toast('Painel duplicado'); location.hash = `#/relatorios/${r.id}`; }) },
    '-',
    { label: 'Excluir', icon: '🗑', danger: true, click: guard(async () => { if (!await confirmDialog(`Excluir o painel "${p.name}" e todos os seus gráficos?`)) return; await api(`/reports/panel/${p.id}`, { method: 'DELETE' }); try { localStorage.removeItem('lente-painel'); } catch {} location.hash = '#/relatorios'; window.dispatchEvent(new Event('lente:refresh')); }) },
  ]);
}

// ---------- grade ----------
function drawGrid(force) {
  const grid = ctx.grid;
  for (const id of [...charts.keys()]) killChart(id);
  clear(grid);
  if (!ctx.charts.length) { grid.append(h('div.empty', { style: { gridColumn: '1 / -1' } }, h('p', 'Este painel ainda não tem gráficos.'), h('button.btn.pri', { on: { click: () => chartEditor({ panel_id: ctx.panelId }) } }, '+ Adicionar gráfico'))); return; }
  ctx.charts.sort((a, b) => a.ord - b.ord || a.id - b.id);
  for (const c of ctx.charts) grid.append(chartCard(c, force));
}
function chartCard(c, force) {
  const age = h('span.age', '…');
  const bodyEl = h('div.cb', h('div.cempty', 'Calculando…'));
  const card = h('div.chart', { dataset: { id: c.id }, style: { gridColumn: `span ${c.w || 6}`, gridRow: `span ${c.h || 8}` } },
    h('div.ch', { draggable: true }, h('h3', { title: c.description || c.name }, c.name), age,
      h('button.iconbtn', { title: 'Atualizar', on: { click: () => load(true) } }, '⟳'),
      h('button.iconbtn', { title: 'Opções', on: { click: e => chartMenu(e.currentTarget, c) } }, '⋯')),
    bodyEl, h('div.rs', { title: 'Redimensionar' }));
  let result = null;
  const load = guard(async (f) => {
    const r = await api('/reports/calc', { body: { chart_id: c.id, force: !!f, filters: ctx.filters } });
    result = r.result; c._result = result; age.textContent = ageLabel(r.cache_at); age.title = `Calculado em ${r.cache_at}`;
    render(bodyEl, c, result);
  });
  load(force);
  // arrastar para reordenar
  const head = card.querySelector('.ch');
  head.addEventListener('dragstart', e => { e.dataTransfer.setData('text/chart', c.id); card.classList.add('dragging'); });
  head.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/chart')) { e.preventDefault(); card.classList.add('over'); } });
  card.addEventListener('dragleave', () => card.classList.remove('over'));
  card.addEventListener('drop', guard(async e => {
    e.preventDefault(); card.classList.remove('over');
    const from = +e.dataTransfer.getData('text/chart'); if (!from || from === c.id) return;
    const list = ctx.charts; const a = list.findIndex(x => x.id === from), b = list.findIndex(x => x.id === c.id);
    const [moved] = list.splice(a, 1); list.splice(b, 0, moved); list.forEach((x, i) => { x.ord = i; });
    await saveLayout(); drawGrid(false);
  }));
  // redimensionar (colunas de 1/12 e linhas de 40px)
  card.querySelector('.rs').addEventListener('pointerdown', e => {
    e.preventDefault();
    const gridRect = ctx.grid.getBoundingClientRect(); const colW = (gridRect.width + 12) / 12; const rect = card.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, w0 = rect.width, h0 = rect.height;
    const mv = ev => {
      c.w = Math.max(2, Math.min(12, Math.round((w0 + ev.clientX - sx + 12) / colW)));
      c.h = Math.max(4, Math.min(24, Math.round((h0 + ev.clientY - sy + 12) / 52)));
      card.style.gridColumn = `span ${c.w}`; card.style.gridRow = `span ${c.h}`;
      charts.get(c.id)?.resize();
    };
    const up = guard(async () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); await saveLayout(); if (result) render(bodyEl, c, result); });
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  c._reload = load;
  return card;
}
const saveLayout = () => api('/reports/layout', { body: { items: ctx.charts.map((x, i) => ({ id: x.id, w: x.w, h: x.h, ord: i })) } });

function chartMenu(anchor, c) {
  menu(anchor, [
    { label: 'Configurar gráfico', icon: '✎', click: () => chartEditor(c) },
    { label: 'Duplicar', icon: '⧉', click: guard(async () => { await api(`/reports/chart/${c.id}/duplicate`, { body: {} }); toast('Gráfico duplicado'); window.dispatchEvent(new Event('lente:refresh')); }) },
    { label: 'Copiar para outro painel', icon: '⇢', click: () => pickPanel(c, false) },
    { label: 'Mover para outro painel', icon: '⇥', click: () => pickPanel(c, true) },
    { label: 'Exportar dados (CSV)', icon: '⇩', click: () => exportChart(c) },
    { label: 'Ver em tela cheia', icon: '⛶', click: () => present(ctx.charts.indexOf(c)) },
    { label: 'Atualizar dados', icon: '⟳', click: () => c._reload?.(true) },
    '-',
    { label: 'Excluir', icon: '🗑', danger: true, click: guard(async () => { if (!await confirmDialog(`Excluir o gráfico "${c.name}"?`)) return; await api(`/reports/chart/${c.id}`, { method: 'DELETE' }); ctx.charts = ctx.charts.filter(x => x.id !== c.id); drawGrid(false); toast('Gráfico excluído'); }) },
  ]);
}
const pickPanel = guard(async (c, move) => {
  const panels = (await api('/reports/panels')).filter(p => p.id !== c.panel_id);
  if (!panels.length) throw new Error('Não há outro painel. Crie um painel primeiro.');
  const s = sel(panels, panels[0].id, { empty: null });
  const m = modal(move ? 'Mover gráfico' : 'Copiar gráfico', field('Painel de destino', s), { foot: [h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'),
    h('button.btn.pri', { on: { click: guard(async () => { await api(`/reports/chart/${c.id}/duplicate`, { body: { panel_id: +s.value, move } }); m.close(); toast(move ? 'Gráfico movido' : 'Gráfico copiado'); window.dispatchEvent(new Event('lente:refresh')); }) } }, move ? 'Mover' : 'Copiar')] });
});
function exportChart(c) {
  const r = c._result; if (!r) return toast('Aguarde o cálculo do gráfico', true);
  let lines;
  if (r.type === 'funnel_history') lines = [['Estágio', 'Alcançaram', 'Conversão p/ próximo (%)', 'Dias médios', 'Perdidos'], ...r.funnel.stages.map(s => [s.name, s.reached, s.conv ?? '', s.avgDays, s.lost])];
  else if (r.pivot) lines = [['', ...r.pivot.colLabels], ...r.rows.map(x => [x.label, ...x.cells])];
  else if (!r.labels.length) lines = [r.series.map(s => s.name), r.series.map(s => s.total)];
  else lines = [['', ...r.series.map(s => s.name)], ...r.labels.map((l, i) => [l, ...r.series.map(s => s.data[i])])];
  download(`${c.name}.csv`, '﻿' + lines.map(l => l.map(v => csvCell(typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';')).join('\n'), 'text/csv');
}

// ---------- renderização ----------
function render(el, c, r) {
  killChart(c.id); clear(el);
  const metrics = c.metrics || [];
  const mById = Object.fromEntries(metrics.map(m => [m.id, m]));
  if (r.type === 'funnel_history') return el.append(renderFunnelHistory(r.funnel));
  if (!r.series?.length) return el.append(h('div.cempty', 'Configure as métricas deste gráfico'));
  const drill = (seriesIdx, keyIdx, extraKey) => { const s = r.series[seriesIdx]; const m = mById[s?.metricId] || metrics.find(x => x.visible) || metrics[0]; if (m) openDrill(c, m, keyIdx == null ? [] : [r.keys[keyIdx], extraKey].filter(x => x != null)); };
  if (r.type !== 'indicator' && !r.labels?.length && !r.pivot)
    return el.append(h('div.cempty', h('div', 'ph:chart-bar'), h('div', 'Sem dados no período'), h('div.small.muted', 'O gráfico aparece assim que houver registros.')));
  if (r.type === 'indicator') {
    const s = r.series[0]; const m = mById[s.metricId];
    return el.append(h('div.indicator', { style: { cursor: 'pointer' }, title: 'Clique para ver os registros', on: { click: () => drill(0, null) } },
      h('div.v', { style: { color: 'var(--fg)', borderLeft: `5px solid ${s.color || 'var(--acc)'}`, paddingLeft: '12px' } }, isMoneyMetric(m) ? money(s.total) : num(s.total, 2)), h('div.s', s.name),
      r.series.slice(1).map((x, i) => h('div.s', `${x.name}: ${fmtVal(x.total, mById[x.metricId])}`))));
  }
  if (r.type === 'table') return el.append(renderTable(r, mById, drill));
  if (r.type === 'map') return el.append(renderMap(r, mById, drill));
  if (r.type === 'funnel') return el.append(renderFunnel(r, mById, drill));
  const canvas = h('canvas'); const box = h('div', { style: { position: 'relative', height: '100%', minHeight: '120px' } }, canvas); el.append(box);
  const fg = css('--text-2'), grid = css('--border');
  // tipografia e tooltip dos gráficos seguem os tokens da interface
  Object.assign(Chart.defaults.font, { family: css('--font') || 'Inter, system-ui, sans-serif', size: 12 });
  Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: css('--toast-bg'), titleColor: css('--toast-text'), bodyColor: css('--toast-text'), padding: 10, cornerRadius: 6, boxPadding: 4, titleFont: { weight: '600' }, displayColors: true, usePointStyle: true });
  const isPie = r.type === 'pie' || r.type === 'donut';
  const datasets = r.series.map((s, i) => {
    const color = s.color || PALETTE[i % PALETTE.length];
    if (isPie) return { label: s.name, data: s.data, backgroundColor: r.labels.map((_, j) => PALETTE[j % PALETTE.length]), borderColor: css('--panel'), borderWidth: 2 };
    return { label: s.name, data: s.data, backgroundColor: r.type === 'area' ? color + '24' : color, borderColor: color, fill: r.type === 'area', tension: .35, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 12, borderWidth: 2, borderRadius: r.type.includes('bar') ? 3 : 0, maxBarThickness: 40 };
  });
  const firstM = mById[r.series[0].metricId];
  const ch = new Chart(canvas, {
    type: { area: 'line', line: 'line', bar: 'bar', hbar: 'bar', pie: 'pie', donut: 'doughnut' }[r.type],
    data: { labels: r.labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, indexAxis: r.type === 'hbar' ? 'y' : 'x',
      interaction: { mode: isPie ? 'nearest' : 'index', intersect: isPie },
      plugins: { legend: { display: isPie || r.series.length > 1, position: isPie ? 'right' : 'bottom', labels: { color: fg, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 14 } },
        tooltip: { callbacks: { label: t => ` ${isPie ? t.label : t.dataset.label}: ${fmtVal(t.raw, mById[r.series[t.datasetIndex]?.metricId])}${isPie && r.total ? ` (${num((t.raw / r.total) * 100, 1)}%)` : ''}` } } },
      scales: isPie ? {} : {
        x: { border: { display: false }, ticks: { color: fg, maxRotation: 0, autoSkip: true, padding: 6, callback: r.type === 'hbar' ? v => compact(v) : function (v) { const l = this.getLabelForValue(v); return String(l).length > 18 ? String(l).slice(0, 17) + '…' : l; } }, grid: { color: grid, display: r.type === 'hbar', drawTicks: false } },
        y: { beginAtZero: true, border: { display: false }, ticks: { color: fg, maxTicksLimit: 6, padding: 8, callback: r.type === 'hbar' ? function (v) { const l = this.getLabelForValue(v); return String(l).length > 22 ? String(l).slice(0, 21) + '…' : l; } : v => (isMoneyMetric(firstM) ? `R$ ${compact(v)}` : compact(v)) }, grid: { color: grid, display: r.type !== 'hbar', drawTicks: false } } },
      onClick: (e, els) => { if (els.length) drill(isPie ? 0 : els[0].datasetIndex, els[0].index); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    },
  });
  charts.set(c.id, ch);
}
function renderTable(r, mById, drill) {
  if (r.pivot) {
    const m = mById[r.series[0].metricId];
    const colTot = r.pivot.cols.map((_, j) => r.rows.reduce((a, x) => a + x.cells[j], 0));
    return h('table.t', h('thead', h('tr', h('th', ''), r.pivot.colLabels.map(l => h('th.num', l)), h('th.num', 'Total'))),
      h('tbody', r.rows.map((x, i) => h('tr.click', h('td', x.label), x.cells.map((v, j) => h('td.num', { on: { click: () => drill(0, i, r.pivot.cols[j]) } }, fmtVal(v, m))), h('td.num', h('b', fmtVal(x.cells.reduce((a, v) => a + v, 0), m))))),
        h('tr', h('td', h('b', 'Total')), colTot.map(v => h('td.num', h('b', fmtVal(v, m)))), h('td.num', h('b', fmtVal(colTot.reduce((a, v) => a + v, 0), m))))));
  }
  return h('table.t', h('thead', h('tr', h('th', ''), r.series.map(s => h('th.num', s.name)))),
    h('tbody', r.labels.map((l, i) => h('tr.click', { on: { click: () => drill(0, i) } }, h('td', l), r.series.map(s => h('td.num', fmtVal(s.data[i], mById[s.metricId]))))),
      h('tr', h('td', h('b', 'Total')), r.series.map(s => h('td.num', h('b', fmtVal(s.data.reduce((a, v) => a + v, 0), mById[s.metricId])))))));
}
// Mapa de calor por estado: quanto mais escuro, maior o valor. Clique abre os registros do estado.
const SVGNS = 'http://www.w3.org/2000/svg';
function renderMap(r, mById, drill) {
  const s = r.series[0]; const m = mById[s.metricId];
  const val = Object.fromEntries(r.keys.map((k, i) => [k, s.data[i]])); const max = Math.max(...s.data, 1);
  const color = s.color || css('--accent');
  const tom = v => v ? `color-mix(in srgb, ${color} ${Math.round(18 + (v / max) * 82)}%, var(--surface-3))` : 'var(--surface-3)';
  const wrap = h('div.brmap');
  const tip = h('div.maptip', { role: 'status' });
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', VIEWBOX); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Mapa do Brasil: ${s.name} por estado`);
  for (const e of ESTADOS) {
    const v = val[e.uf] || 0, idx = r.keys.indexOf(e.uf);
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', e.d); p.setAttribute('class', `uf${v ? '' : ' zero'}`); p.style.fill = tom(v);
    p.setAttribute('tabindex', idx >= 0 ? '0' : '-1');
    const t = document.createElementNS(SVGNS, 'title'); t.textContent = `${e.nome}: ${fmtVal(v, m)}`; p.append(t);
    const mostra = ev => { tip.replaceChildren(h('b', e.nome), h('span', fmtVal(v, m))); tip.classList.add('on');
      const b = wrap.getBoundingClientRect(); const x = (ev.clientX ?? p.getBoundingClientRect().left) - b.left, y = (ev.clientY ?? p.getBoundingClientRect().top) - b.top;
      Object.assign(tip.style, { left: `${Math.min(x + 12, b.width - 150)}px`, top: `${Math.max(0, y - 44)}px` }); };
    p.addEventListener('mousemove', mostra); p.addEventListener('focus', mostra);
    p.addEventListener('mouseleave', () => tip.classList.remove('on')); p.addEventListener('blur', () => tip.classList.remove('on'));
    const abre = () => idx >= 0 && drill(0, idx);
    p.addEventListener('click', abre); p.addEventListener('keydown', ev => { if (ev.key === 'Enter') abre(); });
    svg.append(p);
  }
  wrap.append(svg, tip);
  const total = s.data.reduce((a, v) => a + v, 0);
  const top = r.labels.map((l, i) => [l, s.data[i], i]).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const nome = uf => ESTADOS.find(e => e.uf === uf)?.nome || uf;
  const legenda = h('div.mapleg', h('span', 'menor'), h('i.sw', [.05, .25, .5, .75, 1].map(f => h('b', { style: { background: tom(max * f) } }))), h('span', 'maior'));
  const rank = h('ol.maprank', top.map(([l, v, i]) => h('li', { on: { click: () => drill(0, i) } },
    h('span.n', nome(l)), h('span.v', fmtVal(v, m)), h('span.meter', h('i', { style: { width: `${(v / max) * 100}%`, background: color } })))));
  return h('div.mapc', wrap, h('div.mapside', h('div.small.muted', `${s.name} · total ${fmtVal(total, m)}`), rank, legenda));
}
function renderFunnel(r, mById, drill) {
  const s = r.series[0]; const m = mById[s.metricId]; const max = Math.max(...s.data, 1);
  return h('div.funnelc', r.labels.map((l, i) => h('div.fs', { title: `${l}: ${fmtVal(s.data[i], m)}`, style: { width: `${Math.max(18, (s.data[i] / max) * 100)}%`, background: `color-mix(in srgb, ${s.color || PALETTE[0]} ${100 - Math.min(i, 6) * 11}%, var(--surface))`, color: 'var(--on-accent)' }, on: { click: () => drill(0, i) } },
    `${l} · ${fmtVal(s.data[i], m)}${i && s.data[0] ? ` (${num((s.data[i] / s.data[0]) * 100, 1)}%)` : ''}`)));
}
function renderFunnelHistory(f) {
  const max = Math.max(...f.stages.map(s => s.reached), 1);
  return h('div',
    h('div.row.wrap', { style: { gap: '18px', marginBottom: '8px' } }, [['Negócios', f.total], ['Ganhos', f.won], ['Perdidos', f.lost], ['Em andamento', f.open], ['Taxa de ganho', `${num(f.winRate, 1)}%`], ['Valor ganho', money(f.wonAmount)]]
      .map(([l, v]) => h('div', h('div.small.muted', l), h('b', v)))),
    h('table.fh', h('tbody', h('tr.small.muted', h('td', 'Estágio'), h('td', 'Alcançaram'), h('td', 'Conversão'), h('td', 'Tempo médio'), h('td', 'Perdidos')),
      f.stages.map(s => h('tr', h('td', s.name), h('td', h('div.barw', h('i', { style: { width: `${(s.reached / max) * 100}%` } }), h('span', { style: { position: 'relative', paddingLeft: '6px', fontSize: '12px', color: s.reached / max > .3 ? '#14213d' : 'var(--fg)', fontWeight: 600 } }, s.reached))),
        h('td', s.conv == null ? '—' : `${num(s.conv, 1)}% →`), h('td', `${num(s.avgDays, 1)} dias`), h('td', s.lost))))));
}

// ---------- drill-down ----------
const openDrill = guard(async (c, m, keys) => {
  const r = await api('/reports/drill', { body: { metric_id: m.id, keys, filters: ctx.filters } });
  const ent = ENTITIES[r.entity];
  const cols = r.fields.filter(f => !['id'].includes(f.type)).slice(0, 9);
  if (m.field && !cols.find(f => f.key === m.field)) cols.push(r.fields.find(f => f.key === m.field));
  const link = row => ({ contact: `#/cliente/${row.contact_id}`, deal: `#/negocio/${row.deal_id}`, quote: `#/doc/${row.quote_id}`, order: `#/doc/${row.order_id}`, document: `#/doc/${row.document_id}` }[r.entity]);
  const md = modal(`${c.name} › ${m.name}${keys.length ? ` › ${keys.join(' / ')}` : ''}`, h('div.col',
    h('div.muted', `${r.total} registros${r.total > r.rows.length ? ` (exibindo ${r.rows.length})` : ''} · ${ent.label}`),
    h('div.tablewrap', { style: { maxHeight: '60vh' } }, h('table.t', h('thead', h('tr', cols.map(f => h(`th${NUMERIC.has(f.type) ? '.num' : ''}`, f.label)))),
      h('tbody', r.rows.map(row => h(`tr${link(row) ? '.click' : ''}`, { on: { click: () => { const l = link(row); if (l) { md.close(); location.hash = l; } } } }, cols.map(f => h(`td${NUMERIC.has(f.type) ? '.num' : ''}`, fmtField(row[f.key], f.type))))))))),
  { size: 'wide', foot: [h('button.btn', { on: { click: () => download(`${c.name}-registros.csv`, '﻿' + csvLinhas([cols.map(f => f.label), ...r.rows.map(row => cols.map(f => row[f.key] ?? ''))]), 'text/csv') } }, '⇩ CSV'), h('button.btn.pri', { on: { click: () => md.close() } }, 'Fechar')] });
});

// ---------- apresentação ----------
function present(start) {
  if (!ctx.charts.length) return;
  let i = Math.max(0, start); let timer = null;
  const slot = h('div.pb'); const label = h('span.muted');
  const show = () => {
    const c = ctx.charts[i]; label.textContent = `${i + 1} / ${ctx.charts.length}`; clear(slot);
    const bodyEl = h('div.cb', { style: { padding: '20px' } });
    slot.append(h('div.chart', h('div.ch', { style: { cursor: 'default' } }, h('h3', { style: { fontSize: 'var(--fs-20)' } }, c.name)), bodyEl));
    const id = `p${c.id}`;
    if (c._result) render(bodyEl, { ...c, id }, c._result); else api('/reports/calc', { body: { chart_id: c.id, filters: ctx.filters } }).then(r => { c._result = r.result; render(bodyEl, { ...c, id }, r.result); });
  };
  const nav = d => { killChart(`p${ctx.charts[i].id}`); i = (i + d + ctx.charts.length) % ctx.charts.length; show(); };
  const close = () => { killChart(`p${ctx.charts[i].id}`); clearInterval(timer); el.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') nav(1); if (e.key === 'ArrowLeft') nav(-1); };
  const auto = h('button.btn', { on: { click: () => { if (timer) { clearInterval(timer); timer = null; auto.textContent = '⏵ Automático'; } else { timer = setInterval(() => nav(1), 8000); auto.textContent = '⏸ Pausar'; } } } }, '⏵ Automático');
  const el = h('div.present', slot, h('div.pc', h('button.btn', { on: { click: () => nav(-1) } }, '◀'), label, h('button.btn', { on: { click: () => nav(1) } }, '▶'), auto, h('button.btn', { on: { click: close } }, '✕ Sair')));
  document.body.append(el); document.addEventListener('keydown', key); show();
}

// ---------- filtros de painel ----------
function toggleFilters(forceOpen) {
  const slot = ctx.drawerSlot;
  if (slot.firstChild && !forceOpen) { clear(slot); ctx.filtersOpen = false; return; }
  ctx.filtersOpen = true; clear(slot);
  const list = h('div');
  const box = h('div.fdrawer', h('div.row', { style: { marginBottom: '8px' } }, h('b.grow', 'Filtros do painel'), h('button.iconbtn', { on: { click: () => toggleFilters() } }, '✕')), list,
    h('button.btn', { style: { width: '100%', justifyContent: 'center' }, on: { click: e => menu(e.currentTarget, [{ header: 'Tipo de filtro' }, ...PANEL_FILTER_TYPES.map(t => ({ label: t.label, click: () => filterEditor({ type: t.id, name: t.label, panel_id: ctx.panelId, active: true, value: {}, map: autoMap(t.id) }) }))]) } }, '+ Adicionar filtro'),
    h('p.small.muted', 'Cada filtro é aplicado às métricas mapeadas para ele. Gráficos com filtros ativos são recalculados na hora (sem cache).'));
  const draw = () => {
    clear(list);
    if (!ctx.filters.length) list.append(h('p.muted.small', 'Nenhum filtro neste painel.'));
    for (const f of ctx.filters) list.append(h('div.pfilter', h('div.ph', h('input', { type: 'checkbox', checked: f.active, title: 'Ativar/desativar', on: { change: guard(async e => { f.active = e.target.checked; await api('/reports/filter', { body: f }); applied(); }) } }),
      h('span.grow', f.name), h('button.iconbtn', { title: 'Editar', on: { click: () => filterEditor(f) } }, '✎'),
      h('button.iconbtn', { title: 'Remover', on: { click: guard(async () => { await api(`/reports/filter/${f.id}`, { method: 'DELETE' }); ctx.filters = ctx.filters.filter(x => x !== f); draw(); applied(); }) } }, '✕')),
      h('div.small.muted', describeFilter(f)), h('div.small.muted', `${Object.keys(f.map || {}).length} métrica(s) mapeada(s)`)));
  };
  const applied = () => { ctx.setFiltLabel(); drawGrid(false); draw(); };
  ctx.drawFilters = draw; ctx.filtersApplied = applied;
  draw(); slot.append(box);
}
function describeFilter(f) {
  const v = f.value || {};
  if (f.type === 'date') return v.rel?.id ? `${RELATIVE_DATES.find(r => r.id === v.rel.id)?.label || v.rel.id}${RELATIVE_DATES.find(r => r.id === v.rel.id)?.n ? ` (${v.rel.n})` : ''}` : v.from || v.to ? `${date(v.from) || '…'} a ${date(v.to) || '…'}` : 'Sem valor';
  if (f.type === 'number') return `${v.min ?? '…'} até ${v.max ?? '…'}`;
  if (f.type === 'text') return v.text ? `Contém "${v.text}"` : 'Sem valor';
  return v.values?.length ? v.values.join(', ') : 'Sem valor';
}
// Para cada métrica do painel, campos compatíveis com o tipo de filtro
function compatibleFields(type, m) {
  const ft = PANEL_FILTER_TYPES.find(t => t.id === type)?.fieldTypes || [];
  return ENTITIES[m.entity].fields.filter(([, , t]) => ft.includes(t)).map(([k, l]) => ({ id: k, name: l }));
}
function autoMap(type) {
  const map = {};
  for (const c of ctx.charts) for (const m of c.metrics) {
    const ent = ENTITIES[m.entity]; const opts = compatibleFields(type, m);
    const pref = type === 'user' ? ent.ownerField : type === 'date' ? ent.dateField : null;
    const pick = opts.find(o => o.id === pref) || (opts.length === 1 ? opts[0] : null);
    if (pick) map[m.id] = pick.id;
  }
  return map;
}
async function filterEditor(f0) {
  const f = JSON.parse(JSON.stringify(f0)); f.value ||= {}; f.map ||= {};
  const name = h('input.i', { value: f.name || '' });
  const valBox = h('div');
  // valores possíveis (para usuário, cliente, opção etc.) a partir dos campos mapeados
  const loadValues = async () => {
    const set = new Set();
    for (const c of ctx.charts) for (const m of c.metrics) { const k = f.map[m.id]; if (!k) continue; for (const r of await rowsOf(m.entity)) if (r[k] != null && r[k] !== '') set.add(String(r[k])); }
    if (f.type === 'user') state.meta.users.forEach(u => set.add(u.name));
    if (f.type === 'team') state.meta.teams.forEach(t => set.add(t.name));
    if (f.type === 'state') UFS.forEach(u => set.add(u));
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  };
  const drawValue = async () => {
    clear(valBox); const v = f.value;
    if (f.type === 'date') {
      const mode = sel([{ id: '', name: 'Período fixo' }, ...RELATIVE_DATES.map(r => ({ id: r.id, name: r.label }))], v.rel?.id || '', { empty: null, onchange: x => { f.value = x ? { rel: { id: x, n: v.rel?.n || 3 } } : {}; drawValue(); } });
      valBox.append(field('Período', mode));
      if (v.rel?.id && RELATIVE_DATES.find(r => r.id === v.rel.id)?.n) valBox.append(field('N', h('input.i', { type: 'number', min: 1, value: v.rel.n, on: { input: e => { v.rel.n = +e.target.value; } } })));
      if (!v.rel?.id) valBox.append(h('div.grid2', field('De', h('input.i', { type: 'date', value: v.from || '', on: { input: e => { v.from = e.target.value; } } })), field('Até', h('input.i', { type: 'date', value: v.to || '', on: { input: e => { v.to = e.target.value; } } }))));
    } else if (f.type === 'number') {
      valBox.append(h('div.grid2', field('Mínimo', h('input.i', { type: 'number', value: v.min ?? '', on: { input: e => { v.min = e.target.value === '' ? undefined : +e.target.value; } } })), field('Máximo', h('input.i', { type: 'number', value: v.max ?? '', on: { input: e => { v.max = e.target.value === '' ? undefined : +e.target.value; } } }))));
    } else if (f.type === 'text') {
      valBox.append(field('Contém o texto', h('input.i', { value: v.text || '', on: { input: e => { v.text = e.target.value; } } })));
    } else {
      v.values ||= [];
      const all = await loadValues();
      const box = h('div', { style: { maxHeight: '180px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '7px', padding: '6px' } },
        all.length ? all.map(x => h('label.row', { style: { padding: '2px 0' } }, h('input', { type: 'checkbox', checked: v.values.includes(x), on: { change: e => { v.values = e.target.checked ? [...v.values, x] : v.values.filter(y => y !== x); } } }), x)) : h('span.muted.small', 'Mapeie ao menos uma métrica para listar os valores.'));
      valBox.append(field('Valores', box));
    }
  };
  // mapeamento por métrica
  const mapBox = h('div.col');
  for (const c of ctx.charts) {
    if (!c.metrics.length) continue;
    const rows = c.metrics.map(m => {
      const o = compatibleFields(f.type, m);
      return h('div.row', { style: { paddingLeft: '10px' } }, h('span.grow.small', `${m.name} `, h('span.muted', `(${ENTITIES[m.entity].label})`)),
        o.length ? h('div', { style: { width: '190px' } }, sel(o, f.map[m.id], { empty: 'Não aplicar', onchange: x => { if (x) f.map[m.id] = x; else delete f.map[m.id]; if (!['date', 'number', 'text'].includes(f.type)) drawValue(); } })) : h('span.small.muted', 'sem campo compatível'));
    });
    mapBox.append(h('div', h('b.small', c.name), rows));
  }
  await drawValue();
  const md = modal(f.id ? 'Editar filtro' : 'Novo filtro', h('div.col', field('Nome do filtro', name), valBox, h('details', { open: !f.id }, h('summary', h('b', 'Mapeamento: em qual campo de cada métrica o filtro se aplica')), h('div', { style: { marginTop: '8px' } }, mapBox)),
    h('label.row', h('input', { type: 'checkbox', checked: f.active !== false, on: { change: e => { f.active = e.target.checked; } } }), 'Filtro ativo')), {
    size: 'mid', foot: [h('button.btn', { on: { click: () => md.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => {
      f.name = name.value.trim() || PANEL_FILTER_TYPES.find(t => t.id === f.type)?.label;
      const saved = await api('/reports/filter', { body: { ...f, ord: f.ord ?? ctx.filters.length } });
      const i = ctx.filters.findIndex(x => x.id === saved.id); if (i >= 0) ctx.filters[i] = saved; else ctx.filters.push(saved);
      md.close(); toast('Filtro aplicado'); ctx.filtersApplied?.();
    }) } }, 'Aplicar')] });
}

// ---------- editor de gráfico ----------
function chartEditor(c0) {
  if (!c0.type) return pickType(c0);
  const c = JSON.parse(JSON.stringify({ w: 6, h: 8, metric_limit: 10, history_months: 6, ...c0 }));
  delete c._result; c.metrics = (c0.metrics || []).map(m => ({ ...m }));
  const t = chartType(c.type);
  const name = h('input.i', { value: c.name || '', maxLength: 120, placeholder: 'Nome do gráfico', on: { input: e => { c.name = e.target.value; } } });
  const desc = h('input.i', { value: c.description || '', placeholder: 'Descrição (opcional)', on: { input: e => { c.description = e.target.value; } } });
  const left = h('div.col'); const prevBox = h('div.box'); const prevNote = h('div.small.muted');
  let timer;
  const preview = () => { clearTimeout(timer); timer = setTimeout(guard(async () => {
    prevNote.textContent = 'Calculando…';
    const r = await api('/reports/preview', { body: { chart: { ...c, metrics: undefined }, metrics: c.metrics } });
    const tmp = { ...c, id: 'preview', metrics: c.metrics.map((m, i) => ({ ...m, id: m.id || `tmp${i}` })) };
    render(prevBox, tmp, r.result); prevNote.textContent = `Pré-visualização ao vivo · ${t.label}`;
  }), 250); };
  const draw = () => {
    clear(left);
    left.append(field('Nome', name), field('Descrição', desc),
      h('div.row', h('span.small.muted.grow', `Tipo: ${t.icon} ${t.label}`), h('button.btn.sm', { on: { click: () => { md.close(); pickType(c, true); } } }, 'Trocar tipo')));
    if (c.type === 'funnel_history') {
      left.append(field('Funil', sel(state.meta.pipelines, c.pipeline_id || state.meta.pipelines[0]?.id, { empty: null, onchange: v => { c.pipeline_id = +v; preview(); } })),
        field('Considerar negócios criados nos últimos (meses)', h('input.i', { type: 'number', min: 1, max: 36, value: c.history_months, on: { input: e => { c.history_months = +e.target.value; preview(); } } })));
      c.pipeline_id ||= state.meta.pipelines[0]?.id;
    } else {
      left.append(h('div.row', h('b.grow', `${t.metricName === 'Métrica' ? 'Métricas' : t.metricName + 's'} (${c.metrics.length}/${t.maxM})`),
        c.metrics.length < t.maxM ? h('button.btn.sm.pri', { on: { click: () => metricEditor(c, null, () => { draw(); preview(); }) } }, '+ Adicionar') : null),
      h('div.mlist', c.metrics.length ? c.metrics.map((m, i) => h(`div.mi${m.visible === false ? '.off' : ''}`,
        h('span.dot', { style: { background: m.color || PALETTE[i % PALETTE.length] } }), h('span.nm', { title: m.name }, m.name, h('div.small.muted', `${AGGREGATORS.find(a => a.id === m.aggregator)?.label || ''} · ${ENTITIES[m.entity]?.label}`)),
        h('button.iconbtn', { title: m.visible === false ? 'Mostrar' : 'Ocultar', on: { click: () => { m.visible = m.visible === false; draw(); preview(); } } }, m.visible === false ? 'ph:eye-slash' : 'ph:eye'),
        h('button.iconbtn', { title: 'Subir', disabled: !i, on: { click: () => { [c.metrics[i - 1], c.metrics[i]] = [c.metrics[i], c.metrics[i - 1]]; draw(); preview(); } } }, '↑'),
        h('button.iconbtn', { title: 'Editar', on: { click: () => metricEditor(c, m, () => { draw(); preview(); }) } }, '✎'),
        h('button.iconbtn', { title: 'Duplicar', disabled: c.metrics.length >= t.maxM, on: { click: () => { c.metrics.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(m)), id: undefined, name: `${m.name} (cópia)` }); draw(); preview(); } } }, '⧉'),
        h('button.iconbtn', { title: 'Remover', on: { click: () => { c.metrics.splice(i, 1); draw(); preview(); } } }, '✕'))) : h('div.empty', { style: { padding: '16px' } }, 'Adicione uma métrica para começar')));
      if (t.maxD > 0 && c.type !== 'map') left.append(h('div.grid2',
        field('Limite de itens', h('input.i', { type: 'number', min: 0, value: c.metric_limit, title: '0 = sem limite', on: { input: e => { c.metric_limit = +e.target.value; preview(); } } })),
        field('Ordenação', sel([{ id: 0, name: 'Maior → menor' }, { id: 1, name: 'Menor → maior' }], c.order_asc ? 1 : 0, { empty: null, onchange: v => { c.order_asc = +v; preview(); } }))));
    }
    left.append(h('div.grid2', field('Largura (1–12 colunas)', h('input.i', { type: 'number', min: 2, max: 12, value: c.w, on: { input: e => { c.w = +e.target.value; } } })), field('Altura (linhas)', h('input.i', { type: 'number', min: 4, max: 24, value: c.h, on: { input: e => { c.h = +e.target.value; } } }))));
  };
  draw(); preview();
  const md = modal(c.id ? 'Configurar gráfico' : 'Novo gráfico', h('div.editor', left, h('div.prev', prevNote, prevBox)), {
    size: 'wide', onClose: () => killChart('preview'), foot: [h('button.btn', { on: { click: () => md.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: guard(async () => {
      if (!c.name?.trim()) throw new Error('Dê um nome ao gráfico');
      if (c.metrics.length < t.minM) throw new Error('Adicione ao menos uma métrica');
      const saved = await api('/reports/chart', { body: { chart: { ...c, metrics: undefined }, metrics: c.metrics } });
      const i = ctx.charts.findIndex(x => x.id === saved.id); if (i >= 0) ctx.charts[i] = saved; else ctx.charts.push(saved);
      md.close(); toast('Gráfico salvo'); drawGrid(false);
    }) } }, 'Salvar')] });
}
function pickType(c, change) {
  const md = modal(change ? 'Trocar tipo de gráfico' : 'Escolha o tipo de gráfico', h('div.ctypes', CHART_TYPES.map(t => h('div.ctype', { on: { click: () => {
    md.close();
    const metrics = (c.metrics || []).slice(0, t.maxM).map(m => ({ ...m, dims: t.maxD ? (m.dims || []).slice(0, t.maxD) : [] }));
    chartEditor({ ...c, type: t.id, name: c.name || t.label, metrics });
  } } }, h('div.ic', t.icon), h('b', t.label), h('div.small.muted', t.id === 'funnel_history' ? 'Conversão e tempo por estágio' : `até ${t.maxM} ${t.maxM > 1 ? 'métricas' : 'métrica'}${t.maxD ? ` · ${t.maxD} dimens${t.maxD > 1 ? 'ões' : 'ão'}` : ''}`)))), { size: 'mid' });
}
function metricEditor(c, m0, done) {
  const t = chartType(c.type);
  const isNew = !m0;
  const m = m0 ? JSON.parse(JSON.stringify(m0)) : { entity: 'deal', aggregator: 'count', field: null, color: PALETTE[c.metrics.length % PALETTE.length], visible: true, filter: { conditions: [] }, dims: [] };
  if (isNew && t.maxD && c.metrics[0]?.dims?.length) m.dims = JSON.parse(JSON.stringify(c.metrics[0].dims)).map(d => ({ ...d, field: null }));
  const body = h('div.col');
  let fb;
  const autoName = () => { const a = AGGREGATORS.find(x => x.id === m.aggregator)?.label; const f = ENTITIES[m.entity].fieldMap[m.field]?.label; return m.aggregator === 'count' ? `Quantidade de ${ENTITIES[m.entity].label.toLowerCase()}` : `${a} de ${f || '…'}`; };
  const nameInp = h('input.i', { value: m.name || '', placeholder: 'Automático', on: { input: e => { m.name = e.target.value; } } });
  const draw = () => {
    const ent = ENTITIES[m.entity]; clear(body);
    const numFields = ent.fields.filter(([, , ty]) => NUMERIC.has(ty) && ty !== 'id').map(([k, l]) => ({ id: k, name: l }));
    if (m.aggregator !== 'count' && !numFields.find(f => f.id === m.field)) m.field = numFields[0]?.id || null;
    body.append(h('div.grid3',
      field('1. Módulo (dados de)', sel(Object.values(ENTITIES).map(e => ({ id: e.key, name: e.label })), m.entity, { empty: null, onchange: v => { m.entity = v; m.field = null; m.filter = { conditions: [] }; m.dims = m.dims.map(() => ({ field: null })); draw(); } })),
      field('2. Agregação', sel(AGGREGATORS, m.aggregator, { empty: null, onchange: v => { m.aggregator = v; draw(); } })),
      m.aggregator === 'count' ? field('3. Campo', h('input.i', { value: `Registros de ${ent.label.toLowerCase()}`, disabled: true })) : field('3. Campo', sel(numFields, m.field, { empty: null, onchange: v => { m.field = v; } }))),
    h('div.grid2', field('Nome da métrica', nameInp), field('Cor', h('input.i', { type: 'color', value: m.color || PALETTE[0], style: { height: '36px' }, on: { input: e => { m.color = e.target.value; } } }))));
    // dimensões
    if (t.maxD > 0 && c.type !== 'map') {
      while (m.dims.length < 1) m.dims.push({ field: null });
      const dimFields = ent.fields.filter(([, , ty]) => !['id', 'number', 'money'].includes(ty)).map(([k, l, ty]) => ({ id: k, name: `${l}${ty === 'date' ? ' (data)' : ''}` }));
      const dimBox = h('div.col', h('b', 'Dimensões (agrupar por)'));
      m.dims.slice(0, t.maxD).forEach((d, i) => {
        const isDate = ent.fieldMap[d.field]?.type === 'date';
        dimBox.append(h('div.grid2', field(`Dimensão ${i + 1}`, sel(dimFields, d.field, { empty: i ? 'Nenhuma' : 'Sem dimensão (total)', onchange: v => { d.field = v || null; d.modifier = ent.fieldMap[v]?.type === 'date' ? (d.modifier || 'month') : null; draw(); } })),
          isDate ? field('Intervalo de data', sel(MODIFIERS, d.modifier || 'month', { empty: null, onchange: v => { d.modifier = v; } })) : h('div')));
      });
      if (t.maxD > 1 && m.dims.length < t.maxD && m.dims[0]?.field) dimBox.append(h('button.btn.sm', { on: { click: () => { m.dims.push({ field: null }); draw(); } } }, '+ Segunda dimensão (colunas)'));
      if (c.metrics.length > (isNew ? 0 : 1)) dimBox.append(h('p.small.muted', 'Dica: métricas do mesmo gráfico devem usar dimensões equivalentes (ex.: data de criação por mês) para alinhar os eixos.'));
      body.append(dimBox);
    } else if (c.type === 'map') body.append(h('p.small.muted', '📍 O mapa agrupa automaticamente pelo campo de estado (UF) do módulo escolhido.'));
    fb = filterBuilder(m.entity, m.filter);
    body.append(h('div', h('b', 'Filtro da métrica'), h('p.small.muted', { style: { margin: '2px 0 8px' } }, 'Condições do mesmo grupo valem juntas (E); grupos diferentes são alternativas (OU).'), fb.el));
  };
  draw();
  const md = modal(isNew ? 'Nova métrica' : 'Editar métrica', body, { size: 'mid', foot: [h('button.btn', { on: { click: () => md.close() } }, 'Cancelar'), h('button.btn.pri', { on: { click: () => {
    m.filter = fb.value(); m.dims = (m.dims || []).filter(d => d.field); m.name = (m.name || '').trim() || autoName();
    if (m.aggregator !== 'count' && !m.field) return toast('Escolha o campo numérico', true);
    if (isNew) c.metrics.push(m); else Object.assign(m0, m);
    md.close(); done();
  } } }, 'Confirmar')] });
}
