// Shell do aplicativo: login, layout, roteamento e busca global.
import { h, $, clear, api, state, loadMeta, toast, guard, menu, rowsOf, initials, invalidate, marca, field, modal } from './ui.js';
const ehAdmin = () => state.me?.role === 'Administrador';
import * as P from './pages.js';
import { reportsPage } from './reports.js';
import { whatsappPage } from './whatsapp.js';

const NAV = [
  ['#/', 'ph:house', 'Resumo'], ['#/metas', 'ph:target', 'Metas'], ['#/clientes', 'ph:address-book', 'Clientes'], ['#/negocios', 'ph:handshake', 'Negócios'],
  ['#/propostas', 'ph:file-text', 'Documentos'], ['#/produtos', 'ph:package', 'Produtos'], ['#/tarefas', 'ph:calendar-check', 'Tarefas'], ['#/interacoes', 'ph:chats-circle', 'Interações'],
  ['#/relatorios', 'ph:chart-bar', 'Relatórios'], ['#/whatsapp', 'ph:whatsapp-logo', 'WhatsApp'], ['#/administracao', 'ph:gear-six', 'Administração'],
];

const ROUTES = [
  [/^\/$/, P.homePage], [/^\/metas$/, P.goalsPage], [/^\/clientes$/, P.contactsPage], [/^\/cliente\/(\d+)$/, P.contactDetail],
  [/^\/negocios(?:\/(\d+))?$/, P.dealsPage], [/^\/negocio\/(\d+)$/, P.dealDetail], [/^\/funis$/, P.pipelinesPage],
  [/^\/(propostas|vendas|documentos)$/, P.docsPage], [/^\/doc\/(\d+)$/, P.docEditor], [/^\/doc\/novo\/(quote|order|document)$/, P.docEditor],
  [/^\/produtos$/, P.productsPage], [/^\/tarefas$/, P.tasksPage], [/^\/interacoes$/, P.interactionsPage],
  [/^\/relatorios(?:\/(\d+))?$/, reportsPage], [/^\/whatsapp$/, whatsappPage], [/^\/usuarios$/, P.usersPage], [/^\/administracao(?:\/([\w-]+))?$/, P.adminPage],
];

function loginPage() {
  const email = h('input.i', { type: 'email', autocomplete: 'username', required: true, maxLength: 200 });
  const pw = h('input.i', { type: 'password', autocomplete: 'current-password', required: true });
  const go0 = async () => {
    state.me = await api('/login', { body: { email: email.value, password: pw.value } });
    if (state.me.trocar_senha) return trocaSenhaPage();
    await loadMeta(); location.hash = '#/'; boot();
  };
  pw.addEventListener('input', () => pw.removeAttribute('aria-invalid'));
  const err = h('p.err', { role: 'alert' });
  const entrar = h('button.btn.pri', { type: 'submit' }, 'Entrar');
  const dica = h('p.hint');
  const form = h('form.box', { on: { submit: async e => { e.preventDefault(); err.textContent = ''; entrar.setAttribute('aria-busy', 'true');
      try { await go0(); } catch (x) { err.textContent = x.message === 'E-mail ou senha inválidos' ? 'E-mail ou senha não conferem. Confira e tente de novo.' : x.message; pw.setAttribute('aria-invalid', 'true'); pw.select(); } finally { entrar.removeAttribute('aria-busy'); } } } },
    h('div', h('h1', 'Entrar'), h('p.muted', { style: { margin: '6px 0 0' } }, 'Use o e-mail cadastrado pela sua equipe.')),
    field('E-mail', email), field('Senha', pw), err, entrar,
    dica);
  api('/login-info').then(i => { if (!i.demo) return; dica.textContent = 'Primeiro acesso: admin@lente.local · senha admin123. O sistema pede uma senha nova logo em seguida.'; if (!email.value) email.value = 'admin@lente.local'; }).catch(() => {});
  telaDividida(form);
  setTimeout(() => (email.value ? pw : email).focus(), 50);
}

// Lado institucional da tela de entrada (reaproveitado na troca de senha).
function telaDividida(form) {
  clear($('#root')).append(h('div.login',
    h('section.aside', h('div.brand', marca(36)),
      h('div', h('h2', 'Cada negócio, do primeiro “oi” no WhatsApp à ', h('em', 'proposta assinada'), '.'),
        h('ul', h('li', 'ph:funnel-simple', h('span', 'Funil por estágio, com tempo parado e próxima tarefa em cada card.')),
          h('li', 'ph:whatsapp-logo', h('span', 'Leads de anúncio entram sozinhos, com a campanha de origem.')),
          h('li', 'ph:chart-bar', h('span', 'Painéis de vendas que o gestor monta sem pedir relatório.')))),
      h('p.foot', 'Crmdss · CRM comercial')),
    form));
}

// Troca obrigatória: senha padrão de demonstração ou fraca demais.
function trocaSenhaPage() {
  const nova = h('input.i', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 200 });
  const conf = h('input.i', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 200 });
  const err = h('p.err', { role: 'alert' });
  const salvar = h('button.btn.pri', { type: 'submit' }, 'Salvar e entrar');
  const form = h('form.box', { on: { submit: async e => { e.preventDefault(); err.textContent = '';
      if (nova.value.length < 8) { err.textContent = 'A senha precisa de pelo menos 8 caracteres.'; return nova.focus(); }
      if (nova.value !== conf.value) { err.textContent = 'As duas senhas não são iguais.'; conf.setAttribute('aria-invalid', 'true'); return conf.focus(); }
      salvar.setAttribute('aria-busy', 'true'); salvar.disabled = true;
      try { await api('/me/senha', { method: 'PUT', body: { nova: nova.value } }); state.me.trocar_senha = false; toast('Senha trocada'); location.hash = '#/'; boot(); }
      catch (x) { err.textContent = x.message; nova.setAttribute('aria-invalid', 'true'); nova.select(); }
      finally { salvar.removeAttribute('aria-busy'); salvar.disabled = false; } } } },
    h('div', h('h1', 'Crie sua senha'), h('p.muted', { style: { margin: '6px 0 0' } }, `Olá, ${(state.me?.name || '').split(' ')[0]}. Sua senha atual é a de demonstração ou fácil de adivinhar. Crie uma nova para continuar.`)),
    field('Nova senha', nova), h('p.hint', { style: { margin: '-6px 0 0' } }, 'Mínimo de 8 caracteres. Evite datas e sequências como 12345678.'),
    field('Repita a nova senha', conf), err, salvar,
    h('button.btn.ghost', { type: 'button', on: { click: async () => { await api('/logout', { body: {} }).catch(() => {}); state.me = null; loginPage(); } } }, 'Sair'));
  [nova, conf].forEach(i => i.addEventListener('input', () => i.removeAttribute('aria-invalid')));
  telaDividida(form);
  setTimeout(() => nova.focus(), 50);
}

// Troca voluntária (menu do usuário): pede a senha atual.
function minhaSenha() {
  const atual = h('input.i', { type: 'password', autocomplete: 'current-password', required: true });
  const nova = h('input.i', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 200 });
  const conf = h('input.i', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 200 });
  const m = modal('Trocar minha senha', h('div.col.gap', field('Senha atual', atual), field('Nova senha (mínimo de 8 caracteres)', nova), field('Repita a nova senha', conf),
    h('p.hint', 'Ao trocar, as suas sessões abertas em outros computadores são encerradas.')), { size: 'sm', foot: [h('button.btn', { on: { click: () => m.close() } }, 'Cancelar'),
    h('button.btn.pri', { on: { click: guard(async () => {
      if (nova.value !== conf.value) throw new Error('As duas senhas novas não são iguais.');
      await api('/me/senha', { method: 'PUT', body: { atual: atual.value, nova: nova.value } }); m.close(); toast('Senha trocada');
    }) } }, 'Trocar senha')] });
  setTimeout(() => atual.focus(), 50);
}

function layout() {
  const root = clear($('#root'));
  let min = false; try { min = localStorage.getItem('lente-side') === 'min'; } catch {}
  const side = h(`aside.side${min ? '.min' : ''}`,
    h('div.brand', marca(30)),
    h('nav', NAV.filter(([href]) => href !== '#/administracao' || ehAdmin()).map(([href, ic, label]) => h('a', { href, dataset: { href } }, h('span.ic', ic), h('span.lbl', label)))),
    h('div.foot', h('button.iconbtn', { title: 'Recolher menu', 'aria-label': 'Recolher menu', style: { color: 'var(--sidefg)' }, on: { click: () => { side.classList.toggle('min'); try { localStorage.setItem('lente-side', side.classList.contains('min') ? 'min' : ''); } catch {} } } }, '⇆')));
  const results = h('div.res.hidden');
  const q = h('input', { type: 'search', 'aria-label': 'Buscar', placeholder: 'Buscar cliente, negócio ou proposta', on: { input: () => globalSearch(q.value, results), blur: () => setTimeout(() => results.classList.add('hidden'), 200) } });
  side.addEventListener('click', e => { if (e.target.closest('nav a')) side.classList.remove('open'); });
  const top = h('header.top',
    h('button.iconbtn.navtoggle', { 'aria-label': 'Abrir menu', on: { click: () => side.classList.toggle('open') } }, 'ph:list'),
    h('button.btn', { title: 'Criar cliente, negócio, tarefa…', on: { click: e => menu(e.currentTarget, [
      { header: 'Criar' },
      { label: 'Cliente (empresa)', icon: '🏢', click: () => P.contactForm({ type: 'company' }) },
      { label: 'Cliente (pessoa)', icon: '👤', click: () => P.contactForm({ type: 'person' }) },
      { label: 'Negócio', icon: 'ph:handshake', click: () => P.dealForm({}) },
      { label: 'Tarefa', icon: '✓', click: () => P.taskForm({}) },
      { label: 'Registro de interação', icon: '☏', click: () => P.interactionForm({}) },
      { label: 'Produto', icon: '▣', click: () => P.productForm({}) }]) } }, '+ Criar'),
    h('div.search', q, results), h('span.grow'),
    h('button.iconbtn', { title: 'Tarefas', 'aria-label': 'Tarefas', on: { click: () => { location.hash = '#/tarefas'; } } }, 'ph:calendar-check'),
    h('button.iconbtn', { title: 'Alternar tema claro/escuro', 'aria-label': 'Alternar tema claro/escuro', on: { click: toggleTheme } }, 'ph:moon'),
    h('button.btn.ghost', { on: { click: e => menu(e.currentTarget, [
      { header: state.me.email }, { label: 'Trocar minha senha', icon: 'ph:lock-key', click: minhaSenha },
      ehAdmin() ? { label: 'Usuários', icon: '👥', click: () => { location.hash = '#/usuarios'; } } : null,
      ehAdmin() ? { label: 'Administração', icon: '⚙', click: () => { location.hash = '#/administracao'; } } : null,
      { label: (() => { try { return localStorage.getItem('lente-som') === '0'; } catch { return false; } })() ? 'Ligar som de novo lead' : 'Desligar som de novo lead', icon: '🔔', click: () => { try { localStorage.setItem('lente-som', localStorage.getItem('lente-som') === '0' ? '1' : '0'); } catch {} toast('Preferência salva'); } },
      'Notification' in window && Notification.permission !== 'granted' ? { label: 'Ativar notificações do navegador', icon: '🔔', click: () => Notification.requestPermission() } : null, '-',
      { label: 'Sair', icon: '⏻', click: guard(async () => { await api('/logout', { body: {} }); state.me = null; loginPage(); }) }]) } },
      h('span.avatar', initials(state.me.name)), h('span', state.me.name.split(' ')[0])));
  root.append(h('div#app', side, h('div.main', top, h('main.content#content'))));
}

async function globalSearch(text, box) {
  const q = text.trim().toLowerCase(); clear(box);
  if (q.length < 2) return box.classList.add('hidden');
  const [cs, ds, qs] = await Promise.all([rowsOf('contact'), rowsOf('deal'), rowsOf('quote')]);
  const hit = (v) => String(v || '').toLowerCase().includes(q);
  const items = [
    ...cs.filter(r => hit(r.contact_name) || hit(r.contact_doc) || hit(r.contact_email)).slice(0, 6).map(r => [`#/cliente/${r.contact_id}`, `ph:address-book ${r.contact_name}`, r.contact_city]),
    ...ds.filter(r => hit(r.deal_title)).slice(0, 6).map(r => [`#/negocio/${r.deal_id}`, `ph:handshake ${r.deal_title}`, r.deal_stage]),
    ...qs.filter(r => hit(r.quote_number) || hit(r.quote_title)).slice(0, 4).map(r => [`#/doc/${r.quote_id}`, `ph:file-text Proposta ${r.quote_number}`, r.contact_name]),
  ];
  box.classList.remove('hidden');
  if (!items.length) return box.append(h('div.empty', `Nada com “${text.trim()}” em clientes, negócios ou propostas.`));
  items.forEach(([href, l, s]) => box.append(h('a', { href }, l, s ? h('small.muted', ` · ${s}`) : '')));
}

function toggleTheme() {
  const r = document.documentElement;
  const dark = r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  r.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('lente-tema', r.dataset.theme); } catch {}
  dispatchEvent(new Event('themechange'));
  window.dispatchEvent(new Event('themechange'));
}

async function route() {
  if (!state.me) return;
  const path = (location.hash.slice(1) || '/').split('?')[0];
  if (path === '/login') return loginPage();
  if (!$('#content')) layout();
  document.querySelectorAll('.side nav a').forEach(a => {
    const href = a.dataset.href.slice(1);
    const on = href === '/' ? path === '/' : path.startsWith(href) || (href === '/propostas' && /^\/(vendas|documentos|doc)/.test(path)) || (href === '/negocios' && /^\/(negocio|funis)/.test(path)) || (href === '/clientes' && path.startsWith('/cliente'));
    a.classList.toggle('on', on);
  });
  const content = clear($('#content'));
  document.querySelectorAll('.overlay,.menu,.drawer').forEach(x => x.remove());
  if (!ehAdmin() && /^\/(usuarios|administracao)/.test(path)) return content.append(h('div.page', h('div.empty', 'Somente administradores acessam esta área. Peça ao administrador da sua equipe.')));
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) { try { await fn(content, ...m.slice(1)); } catch (e) { console.error(e); content.append(h('div.page', h('div.empty', `Erro: ${e.message}`))); } return; }
  }
  content.append(h('div.page', h('div.empty', 'Página não encontrada')));
}

// ---------- tempo real (WhatsApp) ----------
let fonte = null;
function bip() {
  try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.setValueAtTime(.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .35);
    o.start(); o.stop(ctx.currentTime + .35); } catch {}
}
function tempoReal() {
  fonte?.close();
  fonte = new EventSource('/api/stream');
  fonte.onmessage = m => {
    const ev = JSON.parse(m.data);
    window.dispatchEvent(new CustomEvent('lente:wa', { detail: ev }));
    if (ev.tipo === 'alerta') toast(ev.texto, true);
    if (ev.tipo !== 'lead' || ev.acao === 'mensagem') return;
    invalidate('deal', 'contact', 'interaction');
    if (ev.acao === 'novo') {
      toast(`Novo lead pelo ${ev.via || 'WhatsApp'}: ${ev.titulo}`);
      let som = true; try { som = localStorage.getItem('lente-som') !== '0'; } catch {}
      if (som) bip();
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Novo lead no Crmdss', { body: ev.titulo });
    } else toast(`Lead voltou a chamar: ${ev.titulo}`);
    // Atualiza a tela do funil/negócio se nada estiver aberto por cima
    const path = location.hash.slice(1).split('?')[0];
    if (!document.querySelector('.overlay') && (/^\/negocios/.test(path) || path === `/negocio/${ev.deal_id}` || path === '/')) route();
  };
}

async function boot() {
  try { state.me = await api('/me'); if (state.me.trocar_senha) return trocaSenhaPage(); await loadMeta(); } catch { return loginPage(); }
  layout(); route(); tempoReal();
}
window.addEventListener('hashchange', route);
window.addEventListener('lente:trocar-senha', () => { if (state.me) { fonte?.close(); trocaSenhaPage(); } });
window.addEventListener('lente:refresh', () => route());
boot();
