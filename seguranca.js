// Crmdss — camada de segurança: erros HTTP, senhas, sessões, limites de tentativa/requisição,
// permissões por papel, validação de entrada, checagem de Host/Origin e cabeçalhos de segurança.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import os from 'node:os';

// ---------- erros com status (a mensagem é segura para o usuário ver) ----------
export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const falha = (status, msg, extra) => { throw new HttpError(status, msg, extra); };

// ---------- senhas: scrypt assíncrono (não trava o servidor), salt de 16 bytes, comparação em tempo constante ----------
const scrypt = promisify(crypto.scrypt);
const HASH_FALSO = `${'0'.repeat(32)}:${'0'.repeat(64)}`; // usado quando o e-mail não existe, para o tempo de resposta ser igual
export async function hashSenha(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(String(pw), salt, 32)).toString('hex')}`;
}
export async function confereSenha(pw, stored) {
  const [salt, h] = String(stored || HASH_FALSO).split(':');
  const esperado = Buffer.from(h || '', 'hex');
  const calc = await scrypt(String(pw), salt || '0', 32);
  return esperado.length === calc.length && crypto.timingSafeEqual(esperado, calc);
}
export const hashAntigo = stored => String(stored || '').split(':')[0].length < 32; // salt de 8 bytes (versão anterior)

const COMUNS = new Set(['admin123', 'lente123', 'crmdss123', '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000',
  'senha123', 'senha1234', 'senha12345', 'mudar123', 'password', 'password1', 'qwerty123', 'abc12345', 'abcd1234', 'admin1234', 'administrador']);
export const senhaFraca = pw => String(pw || '').length < 8 || COMUNS.has(String(pw).toLowerCase());
export function validaSenhaNova(pw, email) {
  const s = String(pw ?? '');
  if (s.length < 8) falha(400, 'A senha precisa de pelo menos 8 caracteres.');
  if (s.length > 200) falha(400, 'Senha longa demais (máximo de 200 caracteres).');
  if (COMUNS.has(s.toLowerCase())) falha(400, 'Essa senha é comum demais. Escolha outra.');
  if (email && s.toLowerCase() === String(email).toLowerCase()) falha(400, 'A senha não pode ser igual ao e-mail.');
  return s;
}

// ---------- sessões: expiram por inatividade e por idade; podem ser derrubadas por usuário ----------
const OCIOSA = 12 * 3600e3;          // 12 h sem uso
const MAXIMA = 7 * 24 * 3600e3;      // 7 dias no máximo
const sessoes = new Map();           // token -> { uid, criada, ultimo, trocar }
export function novaSessao(uid, trocar) {
  const t = crypto.randomBytes(32).toString('hex');
  sessoes.set(t, { uid: +uid, criada: Date.now(), ultimo: Date.now(), trocar: !!trocar });
  return t;
}
export function sessaoValida(token) {
  const s = token && sessoes.get(token); if (!s) return null;
  const n = Date.now();
  if (n - s.ultimo > OCIOSA || n - s.criada > MAXIMA) { sessoes.delete(token); return null; }
  s.ultimo = n; return s;
}
export const encerraSessao = token => sessoes.delete(token);
export function encerraSessoesDo(uid, exceto) { for (const [t, s] of sessoes) if (s.uid === +uid && t !== exceto) sessoes.delete(t); }
export const cookieSessao = (token, segura) => `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAXIMA / 1000}${segura ? '; Secure' : ''}`;
export const cookieApaga = segura => `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${segura ? '; Secure' : ''}`;
setInterval(() => { for (const [t] of sessoes) sessaoValida(t); }, 10 * 60e3).unref();

// ---------- força bruta no login: 5 erros por e-mail+IP ou 30 por IP → bloqueio de 15 min ----------
const JANELA = 15 * 60e3;
const tentativas = new Map(); // chave -> { n, desde, ate }
export function minutosBloqueado(ip, email) {
  const n = Date.now();
  for (const k of [`e:${email}|${ip}`, `ip:${ip}`]) { const t = tentativas.get(k); if (t?.ate > n) return Math.ceil((t.ate - n) / 60e3); }
  return 0;
}
export function registraFalha(ip, email) {
  const n = Date.now();
  for (const [k, lim] of [[`e:${email}|${ip}`, 5], [`ip:${ip}`, 30]]) {
    let t = tentativas.get(k); if (!t || (n - t.desde > JANELA && !(t.ate > n))) t = { n: 0, desde: n, ate: 0 };
    t.n++; if (t.n >= lim) t.ate = n + JANELA; tentativas.set(k, t);
  }
}
export const registraAcerto = (ip, email) => tentativas.delete(`e:${email}|${ip}`);
setInterval(() => { const n = Date.now(); for (const [k, t] of tentativas) if (n - t.desde > JANELA && !(t.ate > n)) tentativas.delete(k); }, 5 * 60e3).unref();

// ---------- rate limit genérico (janela fixa) ----------
export function limitador(max, janelaMs) {
  const m = new Map();
  setInterval(() => { const n = Date.now(); for (const [k, v] of m) if (n - v.desde > janelaMs) m.delete(k); }, janelaMs).unref();
  return k => { const n = Date.now(); let v = m.get(k); if (!v || n - v.desde > janelaMs) { v = { c: 0, desde: n }; m.set(k, v); } return ++v.c <= max; };
}
export const ipDe = req => req.socket.remoteAddress || '?';

// ---------- permissões por papel ----------
export const ADMIN = 'Administrador', GESTOR = 'Gestor', USUARIO = 'Usuário';
export const ehAdmin = u => u?.role === ADMIN;
export const ehGestor = u => u?.role === ADMIN || u?.role === GESTOR;
export const temPapel = (u, papel) => papel === 'admin' ? ehAdmin(u) : papel === 'gestor' ? ehGestor(u) : !!u;
export const MSG_PAPEL = { admin: 'Somente administradores podem fazer isso.', gestor: 'Somente gestores e administradores podem fazer isso.' };
// Quem pode GRAVAR em cada tabela do CRUD genérico (leitura é livre para logados, exceto logs).
export const ESCRITA = { users: 'admin', teams: 'admin', automations: 'admin', options: 'admin', pipelines: 'admin', stages: 'admin',
  goals: 'gestor', goal_panels: 'gestor' };
export const LEITURA = { logs: 'admin' };

// ---------- validação de entrada (tipos vindos do esquema do banco + valores permitidos) ----------
export const ENUMS = {
  deals: { status: ['open', 'won', 'lost'] },
  docs: { kind: ['quote', 'order', 'document'], status: ['open', 'won', 'lost'] },
  users: { role: [ADMIN, GESTOR, USUARIO], active: [0, 1] },
  contacts: { type: ['company', 'person'] },
};
// Campos que nunca vêm do cliente: o servidor calcula.
export const PROTEGIDOS = { docs: ['number', 'revision', 'total'], doc_items: ['total'], users: ['password'] };
const MAX_TEXTO = 20000;
export function validaCampos(table, body, tipos, { ignorar = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) falha(400, 'Dados inválidos.');
  const out = {};
  for (const [k, v0] of Object.entries(body)) {
    if (!(k in tipos) || ignorar.includes(k)) continue; // campos desconhecidos são descartados
    let v = v0; const t = tipos[k];
    if (v === '' || v === null || v === undefined) { out[k] = null; continue; }
    if (t === 'INTEGER' || t === 'REAL') {
      if (typeof v === 'boolean') v = v ? 1 : 0;
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
      if (!Number.isFinite(n) || (t === 'INTEGER' && !Number.isInteger(n))) falha(400, `Valor inválido no campo “${k}”.`);
      out[k] = n;
    } else {
      if (typeof v === 'object') v = JSON.stringify(v);
      v = String(v);
      if (v.length > MAX_TEXTO) falha(400, `Texto longo demais no campo “${k}”.`);
      out[k] = v;
    }
  }
  for (const [k, vals] of Object.entries(ENUMS[table] || {})) if (out[k] != null && !vals.includes(out[k])) falha(400, `Valor não permitido no campo “${k}”.`);
  return out;
}

// ---------- Host / Origin (DNS rebinding e CSRF) ----------
let cacheHosts = null, cacheAt = 0;
export function hostsPermitidos(port, host) {
  if (cacheHosts && Date.now() - cacheAt < 60e3) return cacheHosts;
  const s = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  if (host !== '127.0.0.1' && host !== 'localhost')
    for (const i of Object.values(os.networkInterfaces()).flat()) if (i && i.family === 'IPv4') s.add(`${i.address}:${port}`);
  for (const h of String(process.env.CRM_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) s.add(h);
  cacheHosts = s; cacheAt = Date.now(); return s;
}
export function origemOk(req) {
  if (['GET', 'HEAD'].includes(req.method)) return true;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const o = req.headers.origin; if (!o) return true; // clientes fora do navegador (curl, integrações) não mandam Origin
  try { return new URL(o).host === String(req.headers.host || '').toLowerCase(); } catch { return false; }
}

// ---------- cabeçalhos de segurança ----------
export function cabecalhos(scriptHashes) {
  const csp = ["default-src 'self'", `script-src 'self' ${scriptHashes.join(' ')}`.trim(), "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
  return { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': csp };
}
export const hashScripts = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
