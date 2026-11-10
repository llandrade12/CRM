// Testes de segurança do Crmdss. Rodar com:  npm test
// Sobem um servidor próprio, com banco temporário e sessão de WhatsApp separada — nunca tocam em data/lente.db.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crmdss-teste-'));

async function sobeServidor(porta, envExtra = {}) {
  const p = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env: { ...process.env, PORT: String(porta), HOST: '127.0.0.1',
    CRM_DB: path.join(TMP, `banco-${porta}.db`), CRM_DEMO: '1', WA_SESSAO: path.join(TMP, `wa-${porta}`), ...envExtra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  await new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error('servidor não subiu: ' + saida)), 20000);
    const ver = d => { saida += d; if (saida.includes('rodando')) { clearTimeout(t); ok(); } };
    p.stdout.on('data', ver); p.stderr.on('data', ver);
  });
  return p;
}
const cliente = porta => async (method, rota, { body, sid, headers = {}, raw } = {}) => {
  const r = await fetch(`http://127.0.0.1:${porta}${rota}`, { method, redirect: 'manual',
    headers: { ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...(sid ? { cookie: `sid=${sid}` } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const txt = await r.text(); let json = null; try { json = JSON.parse(txt); } catch {}
  return { status: r.status, json, txt, headers: r.headers, sid: r.headers.get('set-cookie')?.match(/sid=([^;]*)/)?.[1] };
};

// fetch() não deixa trocar o cabeçalho Host; para simular DNS rebinding usamos http.request.
const comHost = (porta, host, method, rota, { body, sid } = {}) => new Promise((ok, falha) => {
  const dados = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port: porta, method, path: rota, headers: { host, ...(dados ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } : {}), ...(sid ? { cookie: `sid=${sid}` } : {}) } },
    res => { let t = ''; res.on('data', c => t += c); res.on('end', () => ok({ status: res.statusCode, txt: t })); });
  r.on('error', falha); r.end(dados);
});
const PORTA = 3291, PORTA_LIMITE = 3292;
const req = cliente(PORTA);
let srv, srvLimite;
const SENHA_ADMIN = 'Adm!nSegura2026', SENHA_MARINA = 'Marina#Vendas2026';
let admin, marina;

before(async () => {
  [srv, srvLimite] = await Promise.all([sobeServidor(PORTA), sobeServidor(PORTA_LIMITE, { CRM_LIMITE_IP: '20' })]);
  // admin e vendedora entram com a senha de demonstração e são obrigados a trocar
  let r = await req('POST', '/api/login', { body: { email: 'admin@lente.local', password: 'admin123' } }); admin = r.sid;
  r = await req('PUT', '/api/me/senha', { sid: admin, body: { nova: SENHA_ADMIN } }); assert.equal(r.status, 200, r.txt);
  r = await req('POST', '/api/login', { body: { email: 'marina@lente.local', password: 'lente123' } }); marina = r.sid;
  r = await req('PUT', '/api/me/senha', { sid: marina, body: { nova: SENHA_MARINA } }); assert.equal(r.status, 200, r.txt);
});
after(() => { srv?.kill(); srvLimite?.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });

// ---------- 12. servidor não cai e não vaza detalhes ----------
test('URL malformada não derruba o servidor', async () => {
  const r = await req('GET', '/%E0%A4%A'); assert.equal(r.status, 400);
  const r2 = await req('GET', '/api/%E0%A4%A', { sid: admin }); assert.ok([400, 404].includes(r2.status));
  assert.equal((await req('GET', '/')).status, 200, 'servidor continua no ar');
});
test('erros não expõem detalhes internos', async () => {
  const r = await req('POST', '/api/t/tasks', { sid: admin, raw: '{quebrado', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'JSON inválido.');
  const r2 = await req('POST', '/api/reports/drill', { sid: admin, body: { metric: { entity: 'nao-existe' } } });
  assert.equal(r2.status, 400); assert.doesNotMatch(r2.txt, /Cannot read|undefined|at /);
});
test('cabeçalhos de segurança presentes', async () => {
  const r = await req('GET', '/');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

// ---------- 5. autenticação ----------
test('senha padrão obriga a troca antes de usar o sistema', async () => {
  const r = await req('POST', '/api/login', { body: { email: 'rafael@lente.local', password: 'lente123' } });
  assert.equal(r.status, 200); assert.equal(r.json.trocar_senha, true);
  const bloq = await req('GET', '/api/rows/deal', { sid: r.sid }); assert.equal(bloq.status, 403); assert.equal(bloq.json.trocar_senha, true);
  assert.equal((await req('GET', '/api/me', { sid: r.sid })).status, 200);
  assert.equal((await req('PUT', '/api/me/senha', { sid: r.sid, body: { nova: '12345678' } })).status, 400, 'senha comum recusada');
  assert.equal((await req('PUT', '/api/me/senha', { sid: r.sid, body: { nova: 'curta' } })).status, 400, 'senha curta recusada');
  assert.equal((await req('PUT', '/api/me/senha', { sid: r.sid, body: { nova: 'Rafael$Campo2026' } })).status, 200);
  assert.equal((await req('GET', '/api/rows/deal', { sid: r.sid })).status, 200, 'liberado depois da troca');
});
test('a dica de demonstração some depois que a senha padrão é trocada', async () => {
  assert.equal((await req('GET', '/api/login-info')).json.demo, false);
});
test('trocar a senha pelo menu exige a senha atual', async () => {
  const r = await req('PUT', '/api/me/senha', { sid: marina, body: { atual: 'errada', nova: 'Outra#Senha2026' } });
  assert.equal(r.status, 400);
});
test('resposta do login não revela a senha nem o hash', async () => {
  const r = await req('POST', '/api/login', { body: { email: 'admin@lente.local', password: SENHA_ADMIN } });
  assert.equal(r.status, 200); assert.equal(r.json.password, undefined);
  const us = await req('GET', '/api/t/users', { sid: admin }); assert.ok(us.json.every(u => u.password === undefined));
});

// ---------- 6 e 3. autorização e mass assignment ----------
test('vendedor não troca a senha do admin nem se promove', async () => {
  assert.equal((await req('PUT', '/api/t/users/1', { sid: marina, body: { password: 'tomada123456' } })).status, 403);
  assert.equal((await req('PUT', '/api/t/users/2', { sid: marina, body: { role: 'Administrador' } })).status, 403);
  assert.equal((await req('POST', '/api/t/users', { sid: marina, body: { name: 'X', email: 'x@x.com', password: 'Qualquer#2026', role: 'Administrador' } })).status, 403);
  assert.equal((await req('POST', '/api/login', { body: { email: 'admin@lente.local', password: SENHA_ADMIN } })).status, 200, 'senha do admin intacta');
});
test('vendedor não acessa áreas administrativas', async () => {
  assert.equal((await req('GET', '/api/t/logs', { sid: marina })).status, 403);
  assert.equal((await req('PUT', '/api/settings/company', { sid: marina, body: { name: 'Hackeada' } })).status, 403);
  assert.equal((await req('POST', '/api/whatsapp/simular', { sid: marina, body: {} })).status, 403);
  assert.equal((await req('POST', '/api/whatsapp/desconectar', { sid: marina, body: {} })).status, 403);
  assert.equal((await req('DELETE', '/api/t/pipelines/1', { sid: marina })).status, 403);
  assert.equal((await req('DELETE', '/api/reports/panel/1', { sid: marina })).status, 403);
  const st = await req('GET', '/api/settings', { sid: marina }); assert.equal(st.json.whatsapp?.lp_token, undefined, 'token da LP escondido');
  const wa = await req('GET', '/api/whatsapp', { sid: marina }); assert.equal(wa.json.config.lp_token, undefined);
  assert.ok((await req('GET', '/api/settings', { sid: admin })).json.whatsapp.lp_token, 'admin continua vendo o token');
});
test('vendedor continua trabalhando normalmente', async () => {
  assert.equal((await req('GET', '/api/rows/deal', { sid: marina })).status, 200);
  const t = await req('POST', '/api/t/tasks', { sid: marina, body: { title: 'Ligar para o cliente', date: '2026-11-11', done: false } });
  assert.equal(t.status, 200, t.txt);
  assert.equal((await req('PUT', `/api/t/tasks/${t.json.id}`, { sid: marina, body: { done: 1 } })).status, 200);
  assert.equal((await req('POST', '/api/deals/1/move', { sid: marina, body: { stage_id: 2 } })).status, 200);
});
test('número, revisão e total de documento só o servidor define', async () => {
  const antes = (await req('GET', '/api/t/docs/1', { sid: admin })).json;
  assert.equal((await req('PUT', '/api/t/docs/1', { sid: admin, body: { number: '<img src=x onerror=alert(1)>', total: 1, title: 'Título novo' } })).status, 200);
  const depois = (await req('GET', '/api/t/docs/1', { sid: admin })).json;
  assert.equal(depois.number, antes.number); assert.equal(depois.total, antes.total); assert.equal(depois.title, 'Título novo');
  assert.equal((await req('POST', '/api/t/docs', { sid: admin, body: { kind: 'quote', number: 1 } })).status, 400);
  const novo = await req('POST', '/api/doc/save', { sid: admin, body: { doc: { kind: 'quote', title: 'Teste', number: 999999 }, items: [{ qty: 2, unit_price: 10 }] } });
  assert.equal(novo.status, 200, novo.txt);
  const d = (await req('GET', `/api/t/docs/${novo.json.id}`, { sid: admin })).json;
  assert.notEqual(d.number, 999999); assert.equal(d.total, 20);
});
test('só existe ao menos um administrador ativo', async () => {
  assert.equal((await req('PUT', '/api/t/users/1', { sid: admin, body: { role: 'Usuário' } })).status, 400);
  assert.equal((await req('PUT', '/api/t/users/1', { sid: admin, body: { active: 0 } })).status, 400);
  assert.equal((await req('DELETE', '/api/t/users/1', { sid: admin })).status, 400);
});

// ---------- 3. validação ----------
test('tipos e valores permitidos são conferidos no servidor', async () => {
  assert.equal((await req('PUT', '/api/t/deals/1', { sid: admin, body: { amount: 'abc' } })).status, 400);
  assert.equal((await req('POST', '/api/deals/1/status', { sid: admin, body: { status: 'hackeado' } })).status, 400);
  assert.equal((await req('PUT', '/api/t/contacts/1', { sid: admin, body: { type: 'robo' } })).status, 400);
  assert.equal((await req('PUT', '/api/t/contacts/1', { sid: admin, body: { notes: 'x'.repeat(20001) } })).status, 400);
  assert.equal((await req('PUT', '/api/t/deals/abc', { sid: admin, body: { title: 'x' } })).status, 400);
  assert.equal((await req('POST', '/api/deals/1/move', { sid: admin, body: { stage_id: 99999 } })).status, 400);
  assert.equal((await req('POST', '/api/t/users', { sid: admin, body: { name: 'Fraca', email: 'fraca@x.com', password: '123' } })).status, 400);
  assert.equal((await req('POST', '/api/t/users', { sid: admin, body: { name: 'Sem email', email: 'nao-e-email', password: 'Boa#Senha2026' } })).status, 400);
});

// ---------- 5 e 14. sessões ----------
test('usuário suspenso perde a sessão na hora', async () => {
  const c = await req('POST', '/api/t/users', { sid: admin, body: { name: 'Temporário', email: 'temp@lente.local', password: 'Temp#Acesso2026', role: 'Usuário' } });
  assert.equal(c.status, 200, c.txt);
  const s = (await req('POST', '/api/login', { body: { email: 'temp@lente.local', password: 'Temp#Acesso2026' } })).sid;
  assert.equal((await req('GET', '/api/rows/deal', { sid: s })).status, 200);
  assert.equal((await req('PUT', `/api/t/users/${c.json.id}`, { sid: admin, body: { active: 0 } })).status, 200);
  assert.equal((await req('GET', '/api/rows/deal', { sid: s })).status, 401);
  assert.equal((await req('POST', '/api/login', { body: { email: 'temp@lente.local', password: 'Temp#Acesso2026' } })).status, 401);
});
test('trocar a senha encerra as outras sessões', async () => {
  const a = (await req('POST', '/api/login', { body: { email: 'marina@lente.local', password: SENHA_MARINA } })).sid;
  const b = (await req('POST', '/api/login', { body: { email: 'marina@lente.local', password: SENHA_MARINA } })).sid;
  assert.equal((await req('PUT', '/api/me/senha', { sid: a, body: { atual: SENHA_MARINA, nova: 'Marina#Nova2026' } })).status, 200);
  assert.equal((await req('GET', '/api/me', { sid: a })).status, 200, 'sessão atual segue');
  assert.equal((await req('GET', '/api/me', { sid: b })).status, 401, 'outra sessão derrubada');
  marina = a;
});
test('logout invalida a sessão no servidor', async () => {
  const s = (await req('POST', '/api/login', { body: { email: 'admin@lente.local', password: SENHA_ADMIN } })).sid;
  assert.equal((await req('POST', '/api/logout', { sid: s, body: {} })).status, 200);
  assert.equal((await req('GET', '/api/me', { sid: s })).status, 401);
});
test('cookie de sessão é HttpOnly e SameSite', async () => {
  const r = await fetch(`http://127.0.0.1:${PORTA}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@lente.local', password: SENHA_ADMIN }) });
  const c = r.headers.get('set-cookie'); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/); assert.match(c, /Max-Age=604800/);
});

// ---------- 10 e 19. Host / Origin / CSRF ----------
test('Host forjado (DNS rebinding) é recusado', async () => {
  assert.equal((await comHost(PORTA, 'atacante.example', 'POST', '/api/login', { body: { email: 'admin@lente.local', password: SENHA_ADMIN } })).status, 421);
  assert.equal((await comHost(PORTA, 'atacante.example:3291', 'GET', '/api/rows/deal', { sid: admin })).status, 421);
  assert.equal((await comHost(PORTA, `localhost:${PORTA}`, 'GET', '/api/rows/deal', { sid: admin })).status, 200, 'endereço legítimo segue funcionando');
});
test('requisições de outra origem são recusadas', async () => {
  assert.equal((await req('POST', '/api/t/tasks', { sid: admin, headers: { origin: 'https://atacante.example' }, body: { title: 'x' } })).status, 403);
  assert.equal((await req('POST', '/api/t/tasks', { sid: admin, headers: { 'sec-fetch-site': 'cross-site' }, body: { title: 'x' } })).status, 403);
  assert.equal((await req('POST', '/api/t/tasks', { sid: admin, raw: 'title=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await req('POST', '/api/t/tasks', { sid: admin, headers: { origin: `http://127.0.0.1:${PORTA}` }, body: { title: 'Mesma origem' } })).status, 200);
});
test('landing page pública continua funcionando por outro endereço', async () => {
  const tok = (await req('GET', '/api/settings', { sid: admin })).json.whatsapp.lp_token;
  assert.equal((await comHost(PORTA, 'minha-landing.example', 'GET', `/api/lp/${tok}`)).status, 200);
  assert.equal((await comHost(PORTA, 'minha-landing.example', 'GET', '/api/lp/token-errado')).status, 404);
  assert.ok(tok.length >= 10);
});

// ---------- 8. força bruta e 5. enumeração ----------
test('login bloqueia depois de 5 senhas erradas', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await req('POST', '/api/login', { body: { email: 'juliana@lente.local', password: `errada${i}` } })).status, 401);
  const r = await req('POST', '/api/login', { body: { email: 'juliana@lente.local', password: 'lente123' } });
  assert.equal(r.status, 429, 'bloqueado mesmo com a senha certa'); assert.match(r.json.error, /Tente de novo em \d+ min/);
});
test('o tempo de resposta não revela se o e-mail existe', async () => {
  const mede = async email => { const t = performance.now(); await req('POST', '/api/login', { body: { email, password: 'nao-e-essa' } }); return performance.now() - t; };
  const med = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const existe = [], naoExiste = [];
  for (let i = 0; i < 4; i++) { existe.push(await mede('bruno@lente.local')); naoExiste.push(await mede(`ninguem${i}@x.com`)); }
  assert.ok(med(naoExiste) > med(existe) * 0.5, `existe ${med(existe).toFixed(0)}ms × não existe ${med(naoExiste).toFixed(0)}ms`);
  assert.equal((await req('POST', '/api/login', { body: { email: 'ninguem@x.com', password: 'x' } })).json.error, 'E-mail ou senha inválidos');
});

// ---------- 15. rate limit ----------
test('excesso de requisições recebe 429', async () => {
  const outro = cliente(PORTA_LIMITE); const st = [];
  for (let i = 0; i < 25; i++) st.push((await outro('GET', '/api/login-info')).status);
  assert.ok(st.includes(429), st.join(',')); assert.equal(st[0], 200);
});

// ---------- 7. senha no banco ----------
test('senhas novas usam scrypt com salt de 16 bytes', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(TMP, `banco-${PORTA}.db`), { readOnly: true });
  const u = db.prepare("SELECT password FROM users WHERE email='admin@lente.local'").get();
  const [salt, h] = u.password.split(':'); assert.equal(salt.length, 32); assert.equal(h.length, 64); assert.doesNotMatch(u.password, /Adm!n/);
  db.close();
});

// ---------- 9. envio duplicado, importação em lote e entrada pública ----------
test('o mesmo envio repetido em sequência grava uma vez só', async () => {
  const conta = async () => (await req('GET', '/api/t/interactions', { sid: admin })).json.length;
  const n0 = await conta(); const corpo = { contact_id: 1, description: 'Ligação de retorno — teste duplicado', date: '2026-11-10' };
  const rs = await Promise.all([1, 2, 3].map(() => req('POST', '/api/t/interactions', { sid: admin, body: corpo })));
  assert.ok(rs.every(r => r.status === 200)); assert.equal(new Set(rs.map(r => r.json.id)).size, 1, 'mesma resposta para os três');
  assert.equal(await conta(), n0 + 1);
});
test('importação de 1.500 clientes funciona de uma vez e relata linhas ruins', async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ name: `Cliente Importado ${i}`, type: 'company', city: 'Salvador', state: 'BA' }));
  rows.push({ name: '', type: 'company' }, { name: 'E-mail ruim', email: 'nao-e-email' }, { name: 'Tipo ruim', type: 'robo' });
  const r = await req('POST', '/api/import/contacts', { sid: marina, body: { rows } });
  assert.equal(r.status, 200, r.txt); assert.equal(r.json.criados, 1500); assert.equal(r.json.total_erros, 3);
  assert.deepEqual(r.json.erros.map(e => e.linha), [1501, 1502, 1503]);
  assert.equal((await req('POST', '/api/import/contacts', { sid: marina, body: { rows: Array(5001).fill({ name: 'x' }) } })).status, 400);
});
test('formulário público corta campos gigantes e ignora campos estranhos', async () => {
  const tok = (await req('GET', '/api/settings', { sid: admin })).json.whatsapp.lp_token;
  const r = await req('POST', `/api/webhook/lp/${tok}`, { body: { nome: 'N'.repeat(5000), telefone: '71 9' + '8'.repeat(40), utm_campaign: 'c'.repeat(5000), role: 'Administrador', owner_id: 1 } });
  assert.equal(r.status, 200, r.txt);
  const d = (await req('GET', `/api/deal/${r.json.id}/full`, { sid: admin })).json.deal;
  assert.ok(d.contact_name.length <= 120, `nome com ${d.contact_name.length}`);
  assert.ok(String(d.utm_campaign).length <= 200); assert.ok(String(d.contact_phone || '').replace(/\D/g, '').length <= 15);
});
