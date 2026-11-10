// WhatsApp do Crmdss — trazido do CRM de Tráfego (Baileys, "dispositivo conectado").
// O CRM SÓ LÊ as mensagens que chegam: não envia, não marca como lida e não fica "online".
// Quem chama vira Cliente + Negócio no funil configurado, com a origem do anúncio (Clique para WhatsApp)
// ou da landing page (código invisível na mensagem). Quem já tem negócio aberto e volta a chamar
// fica no estágio atual e só registra o retorno.
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from 'baileys';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';

const PASTA_SESSAO = process.env.WA_SESSAO || 'data/whatsapp-sessao';
const logger = pino({ level: process.env.WA_LOG || 'silent' });
const ALERTA_MINUTOS = Number(process.env.ALERTA_DESCONEXAO_MINUTOS || 3);

export const bus = new EventEmitter();
bus.setMaxListeners(500);

let db, logFn, agora;
const e = { status: 'desconectado', tentativas: 0 }; // estado da conexão (uma empresa por instalação)

// ---------- banco: colunas e tabelas extras ----------
export function iniciarWhatsapp({ database, log, now }) {
  db = database; logFn = log; agora = now;
  const add = (tabela, defs) => {
    const tem = new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name));
    for (const [nome, tipo] of defs) if (!tem.has(nome)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${tipo}`);
  };
  add('contacts', [['wa_jid', 'TEXT'], ['wa_phone', 'TEXT']]);
  add('deals', [['source', 'TEXT'], ['platform', 'TEXT'], ['ad_id', 'TEXT'], ['ad_title', 'TEXT'], ['ad_url', 'TEXT'], ['ctwa_clid', 'TEXT'],
    ['utm_source', 'TEXT'], ['utm_medium', 'TEXT'], ['utm_campaign', 'TEXT'], ['utm_content', 'TEXT'], ['utm_term', 'TEXT'],
    ['returns', 'INTEGER DEFAULT 0'], ['recent_platform', 'TEXT'], ['recent_ad_title', 'TEXT'], ['recent_at', 'TEXT'],
    ['last_message', 'TEXT'], ['last_message_at', 'TEXT']]);
  db.exec(`CREATE TABLE IF NOT EXISTS lp_clicks (code TEXT PRIMARY KEY, deal_id INTEGER, name TEXT, phone TEXT,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, page TEXT, created_at TEXT)`);
  // Origens usadas pelos leads automáticos
  for (const n of ['Anúncio Instagram', 'Anúncio Facebook', 'Anúncio Meta', 'Landing page', 'WhatsApp']) {
    if (!db.prepare("SELECT 1 FROM options WHERE kind='origin' AND name=?").get(n)) db.prepare("INSERT INTO options (kind,name,ord) VALUES ('origin',?,90)").run(n);
  }
  if (!config().lp_token) salvarConfig({ ...config(), lp_token: randomBytes(16).toString('base64url') });
  // Reconecta sozinho só se a sessão salva já foi vinculada (QR escaneado)
  let registrado = false;
  try { registrado = JSON.parse(readFileSync(path.join(PASTA_SESSAO, 'creds.json'), 'utf8')).registered === true; } catch {}
  if (registrado) conectar().catch(err => console.error('[wa] falha ao restaurar', err.message));
  else if (existsSync(PASTA_SESSAO)) rmSync(PASTA_SESSAO, { recursive: true, force: true });
}

const PADRAO = { only_ads: true, pipeline_id: null, stage_id: null, owner_id: null, return_hours: 24, lp_number: '', lp_message: 'Olá{nome}! Quero falar com um consultor.' };
export function config() {
  const v = db.prepare("SELECT value FROM settings WHERE key='whatsapp'").get()?.value;
  try { return { ...PADRAO, ...(v ? JSON.parse(v) : {}) }; } catch { return { ...PADRAO }; }
}
export function salvarConfig(c) { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('whatsapp',?)").run(JSON.stringify({ ...config(), ...c })); }

const emitir = (tipo, dados = {}) => bus.emit('evento', { tipo, ...dados });
export const statusWhatsapp = () => ({ status: e.status, qr: e.qr || null, codigo: e.codigo || null, numero: e.numero || null, erro: e.erro || null });
function alertar(texto) { logFn(null, 'alerta WhatsApp', 'whatsapp', null, texto); emitir('alerta', { texto }); }

let versaoWA;
async function versao() { if (versaoWA) return versaoWA; try { versaoWA = (await fetchLatestBaileysVersion()).version; } catch {} return versaoWA; }

// ---------- conexão ----------
/** modo 'qr' gera QR Code; modo 'codigo' gera código de 8 dígitos para digitar no celular. */
export async function conectar({ modo = 'qr', telefone } = {}) {
  if (e.sock && ['conectando', 'aguardando_qr', 'aguardando_codigo', 'conectado'].includes(e.status)) {
    if (e.status === 'conectado') return statusWhatsapp();
    encerrarSocket();
  }
  e.manual = false; e.erro = null; e.qr = null; e.codigo = null; e.status = 'conectando';
  emitir('whatsapp', statusWhatsapp());

  const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
  if (state.creds.registered) e.jaConectou = true;
  const sock = makeWASocket({
    auth: state, logger, version: await versao(),
    browser: Browsers.ubuntu('Crmdss'),      // nome em "Dispositivos conectados"
    markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false, generateHighQualityLinkPreview: false,
  });
  e.sock = sock;
  sock.ev.on('creds.update', saveCreds);

  if (modo === 'codigo' && !state.creds.registered) {
    const numero = String(telefone || '').replace(/\D/g, '');
    if (numero.length < 12) {
      e.status = 'erro'; e.erro = 'Informe o número com DDI e DDD, ex.: 5571999998888';
      encerrarSocket(); emitir('whatsapp', statusWhatsapp()); return statusWhatsapp();
    }
    setTimeout(async () => {
      try { const cod = await sock.requestPairingCode(numero); e.codigo = cod?.match(/.{1,4}/g)?.join('-') || cod; e.status = 'aguardando_codigo'; }
      catch (err) { e.status = 'erro'; e.erro = 'Não foi possível gerar o código: ' + err.message; }
      emitir('whatsapp', statusWhatsapp());
    }, 2500);
  }

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && modo === 'qr') { e.qr = await QRCode.toDataURL(qr, { margin: 1, width: 300 }); e.status = 'aguardando_qr'; emitir('whatsapp', statusWhatsapp()); }
    if (connection === 'open') {
      e.status = 'conectado'; e.qr = null; e.codigo = null; e.tentativas = 0; e.jaConectou = true;
      e.numero = (sock.user?.id || '').split(':')[0].split('@')[0];
      clearTimeout(e.timerAlerta); e.timerAlerta = null;
      if (e.alertado) { e.alertado = false; alertar(`WhatsApp ${e.numero} reconectado.`); }
      logFn(null, 'WhatsApp conectado', 'whatsapp', null, e.numero);
      emitir('whatsapp', statusWhatsapp());
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      e.sock = null;
      if (e.manual) return;
      if (codigo === DisconnectReason.loggedOut) {
        rmSync(PASTA_SESSAO, { recursive: true, force: true });
        e.status = 'desconectado'; e.qr = null; e.numero = null; e.jaConectou = false;
        clearTimeout(e.timerAlerta); e.timerAlerta = null; e.alertado = false;
        alertar('WhatsApp desvinculado no celular. Vincule de novo na tela WhatsApp para voltar a receber leads.');
        emitir('whatsapp', statusWhatsapp()); return;
      }
      e.tentativas = (e.tentativas || 0) + 1;
      const espera = Math.min(60_000, 2_000 * e.tentativas);
      if (!state.creds.registered && e.tentativas > 3) { e.status = 'desconectado'; e.qr = null; emitir('whatsapp', statusWhatsapp()); return; }
      if (e.jaConectou && !e.timerAlerta && !e.alertado) {
        e.timerAlerta = setTimeout(() => {
          e.timerAlerta = null;
          if (e.status === 'conectado' || e.manual) return;
          e.alertado = true; alertar(`WhatsApp desconectado há ${ALERTA_MINUTOS} min (código ${codigo ?? '—'}). Tentando reconectar…`);
        }, ALERTA_MINUTOS * 60e3);
      }
      e.status = 'conectando'; emitir('whatsapp', statusWhatsapp());
      setTimeout(() => conectar({ modo: 'qr' }).catch(() => {}), espera);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return; // ignora histórico: contatos antigos não viram lead
    for (const m of messages) { try { processarMensagem(m); } catch (err) { console.error('[wa] erro ao processar', err); } }
  });
  return statusWhatsapp();
}
function encerrarSocket() { e.manual = true; try { e.sock?.end(undefined); } catch {} e.sock = null; }
export async function desconectar({ desvincular = true } = {}) {
  e.manual = true; clearTimeout(e.timerAlerta); e.timerAlerta = null; e.alertado = false;
  if (desvincular) e.jaConectou = false;
  try { if (desvincular) await e.sock?.logout(); else e.sock?.end(undefined); } catch {}
  e.sock = null; e.qr = null; e.codigo = null; e.numero = null; e.status = 'desconectado';
  if (desvincular) rmSync(PASTA_SESSAO, { recursive: true, force: true });
  logFn(null, desvincular ? 'WhatsApp desvinculado' : 'vinculação cancelada', 'whatsapp', null);
  emitir('whatsapp', statusWhatsapp());
}

// ---------- leitura das mensagens ----------
function desembrulhar(msg) {
  let m = msg || {};
  for (let i = 0; i < 5; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!inner) break; m = inner;
  }
  return m;
}
function extrair(msg) {
  const m = desembrulhar(msg);
  let ctx = null;
  for (const v of Object.values(m)) if (v && typeof v === 'object' && v.contextInfo) { ctx = v.contextInfo; break; }
  const texto = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption ||
    (m.audioMessage ? '🎤 Áudio' : '') || (m.imageMessage ? '📷 Imagem' : '') || (m.documentMessage ? '📄 Documento' : '') || (m.stickerMessage ? 'Figurinha' : '') || '';
  return { ctx, texto };
}
/** Origem do anúncio Clique para WhatsApp (contextInfo.externalAdReply). */
export function origemAnuncio(ctx) {
  if (!ctx) return null;
  const ad = ctx.externalAdReply || {};
  const veio = !!(ad.sourceId || ad.ctwaClid || ad.sourceType === 'ad' || /ads?/i.test(ctx.conversionSource || '') || /ads?/i.test(ctx.entryPointConversionSource || ''));
  if (!veio) return null;
  const url = ad.sourceUrl || ''; const app = (ad.sourceApp || ctx.entryPointConversionApp || '').toLowerCase();
  const plataforma = /instagram/.test(url + app) ? 'instagram' : /facebook|fb\.me|fb\.com/.test(url + app) ? 'facebook' : 'meta';
  return { anuncio_id: ad.sourceId || null, anuncio_titulo: ad.title || ad.body || null, anuncio_url: url || null, ctwa_clid: ad.ctwaClid || null, plataforma };
}
function processarMensagem(m) {
  const k = m.key || {};
  if (k.fromMe) return;
  const remoto = k.remoteJid || '';
  if (/@g\.us$|@broadcast$|@newsletter$/.test(remoto)) return;
  const jidTel = [k.remoteJidAlt, k.senderPn, remoto].find(j => j && j.endsWith('@s.whatsapp.net')); // prefere o número real ao LID
  const jid = jidTel || remoto;
  const { ctx, texto } = extrair(m.message);
  receberContato({ jid, telefone: jidTel ? jidTel.split('@')[0] : null, nome: m.pushName || null, texto, origem: origemAnuncio(ctx) });
}

// ---------- código invisível da landing page ----------
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RE_CODIGO = /\bLP-([A-HJ-NP-Z2-9]{5})\b/i;
export function codigoInvisivel(codigo) {
  const bits = [...codigo].map(c => ALFABETO_CODIGO.indexOf(c).toString(2).padStart(5, '0')).join('');
  return '⁠' + [...bits].map(b => (b === '1' ? '‌' : '​')).join('') + '⁠';
}
function lerCodigoInvisivel(texto) {
  const m = /⁠([​‌]{25})⁠/.exec(texto || ''); if (!m) return null;
  const bits = [...m[1]].map(c => (c === '‌' ? '1' : '0')).join('');
  return bits.match(/.{5}/g).map(b => ALFABETO_CODIGO[parseInt(b, 2)]).join('');
}
const semInvisiveis = t => String(t || '').replace(/[​‌⁠]/g, '');
export const plataformaDeUtm = src => { const s = String(src || '').toLowerCase(); return /ig|insta/.test(s) ? 'instagram' : /fb|face|meta/.test(s) ? 'facebook' : /google|gads/.test(s) ? 'google' : null; };

// ---------- criação / atualização do lead (Cliente + Negócio) ----------
const so = t => String(t || '').replace(/\D/g, '');
const telBR = t => { const d = so(t).replace(/^55/, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : d || null; };
function acharContato(jid, telefone) {
  if (jid) { const c = db.prepare('SELECT * FROM contacts WHERE wa_jid=?').get(jid); if (c) return c; }
  const t = so(telefone); if (!t) return null;
  const fim = t.replace(/^55/, '').slice(-8); // compara pelo final (com/sem 9º dígito e DDI)
  return db.prepare("SELECT * FROM contacts WHERE wa_phone=? OR phone IS NOT NULL").all(t).find(c => c.wa_phone === t || (so(c.phone).length >= 8 && so(c.phone).slice(-8) === fim)) || null;
}
const negocioAberto = contactId => db.prepare("SELECT * FROM deals WHERE contact_id=? AND status='open' ORDER BY id DESC LIMIT 1").get(contactId);
const origemId = plat => db.prepare("SELECT id FROM options WHERE kind='origin' AND name=?").get(
  { instagram: 'Anúncio Instagram', facebook: 'Anúncio Facebook', meta: 'Anúncio Meta', lp: 'Landing page', whatsapp: 'WhatsApp' }[plat] || 'WhatsApp')?.id || null;
const tipoWhatsapp = () => db.prepare("SELECT id FROM options WHERE kind='interaction_type' AND name='WhatsApp'").get()?.id || null;

function destino() {
  const c = config();
  let pipe = c.pipeline_id && db.prepare('SELECT * FROM pipelines WHERE id=?').get(c.pipeline_id);
  if (!pipe) pipe = db.prepare('SELECT * FROM pipelines WHERE archived=0 OR archived IS NULL ORDER BY favorite DESC, ord, id LIMIT 1').get();
  let stage = c.stage_id && db.prepare('SELECT * FROM stages WHERE id=? AND pipeline_id=?').get(c.stage_id, pipe.id);
  if (!stage) stage = db.prepare('SELECT * FROM stages WHERE pipeline_id=? ORDER BY ord LIMIT 1').get(pipe.id);
  const owner = (c.owner_id && db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(c.owner_id)?.id) ||
    db.prepare("SELECT id FROM users WHERE active=1 ORDER BY (role='Administrador') DESC, id LIMIT 1").get()?.id;
  return { pipe, stage, owner };
}
function registrarInteracao({ contactId, dealId, ownerId, texto }) {
  const t = agora();
  db.prepare('INSERT INTO interactions (contact_id,deal_id,owner_id,type_id,date,description,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(contactId, dealId, ownerId, tipoWhatsapp(), t, texto, t);
  db.prepare('UPDATE contacts SET last_contact_at=? WHERE id=?').run(t, contactId);
}
function criarNegocio({ contato, nome, telefone, jid, texto, origem, utm, plataforma, fonte }) {
  const { pipe, stage, owner } = destino(); const t = agora();
  let contactId = contato?.id;
  if (!contactId) {
    contactId = Number(db.prepare(`INSERT INTO contacts (type,name,phone,wa_jid,wa_phone,origin_id,owner_id,created_at,last_contact_at,notes)
      VALUES ('person',?,?,?,?,?,?,?,?,?)`).run(nome || telBR(telefone) || 'Contato do WhatsApp', telBR(telefone), jid, so(telefone) || null,
      origemId(plataforma || fonte), owner, t, t, telefone ? null : 'Telefone oculto pelo WhatsApp (LID).').lastInsertRowid);
  } else db.prepare('UPDATE contacts SET wa_jid=COALESCE(wa_jid,?), wa_phone=COALESCE(wa_phone,?) WHERE id=?').run(jid, so(telefone) || null, contactId);
  const nomeC = db.prepare('SELECT name FROM contacts WHERE id=?').get(contactId).name;
  const titulo = `${origem?.anuncio_titulo || (utm?.utm_campaign ? 'LP · ' + utm.utm_campaign : fonte === 'lp' ? 'Landing page' : 'WhatsApp')} — ${nomeC}`;
  const dealId = Number(db.prepare(`INSERT INTO deals (title,contact_id,pipeline_id,stage_id,owner_id,origin_id,amount,status,created_at,stage_changed_at,start_date,
    source,platform,ad_id,ad_title,ad_url,ctwa_clid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,last_message,last_message_at,returns)
    VALUES (?,?,?,?,?,?,0,'open',?,?,?, ?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(titulo.slice(0, 200), contactId, pipe.id, stage.id, owner, origemId(plataforma || fonte), t, t, t.slice(0, 10),
    fonte, plataforma || null, origem?.anuncio_id || null, origem?.anuncio_titulo || null, origem?.anuncio_url || null, origem?.ctwa_clid || null,
    utm?.utm_source || null, utm?.utm_medium || null, utm?.utm_campaign || null, utm?.utm_content || null, utm?.utm_term || null,
    texto ? texto.slice(0, 300) : null, texto ? t : null).lastInsertRowid);
  db.prepare('INSERT INTO deal_history (deal_id,stage_id,entered_at) VALUES (?,?,?)').run(dealId, stage.id, t);
  const via = fonte === 'lp' ? `landing page${utm?.utm_campaign ? ' (' + utm.utm_campaign + ')' : ''}` : origem ? `anúncio ${origem.plataforma}: ${origem.anuncio_titulo || origem.anuncio_id || ''}` : 'WhatsApp (sem anúncio)';
  if (texto) registrarInteracao({ contactId, dealId, ownerId: owner, texto: `Entrou pelo ${via}.\n“${texto.slice(0, 500)}”` });
  logFn(null, 'novo lead', 'deals', dealId, via);
  emitir('lead', { acao: 'novo', deal_id: dealId, titulo, via });
  return dealId;
}
function registrarRetorno(deal, { texto, origem, plataforma, rotulo, contaRetorno }) {
  const t = agora();
  db.prepare(`UPDATE deals SET last_message=COALESCE(?,last_message), last_message_at=?, returns=returns+? WHERE id=?`).run(texto ? texto.slice(0, 300) : null, t, contaRetorno ? 1 : 0, deal.id);
  if (origem || plataforma) db.prepare('UPDATE deals SET recent_platform=?, recent_ad_title=?, recent_at=? WHERE id=?').run(origem?.plataforma || plataforma || null, origem?.anuncio_titulo || rotulo || null, t, deal.id);
  if (contaRetorno) {
    registrarInteracao({ contactId: deal.contact_id, dealId: deal.id, ownerId: deal.owner_id, texto: `${rotulo || (origem ? `Voltou por anúncio: ${origem.anuncio_titulo || origem.anuncio_id || ''}` : 'Voltou a chamar no WhatsApp')}.${texto ? `\n“${texto.slice(0, 500)}”` : ''}` });
    logFn(null, 'lead voltou', 'deals', deal.id, rotulo || 'WhatsApp');
    emitir('lead', { acao: 'retorno', deal_id: deal.id, titulo: deal.title });
  } else emitir('lead', { acao: 'mensagem', deal_id: deal.id });
  return deal.id;
}

/** Entrada única para mensagens recebidas (também usada pelos simuladores). */
export function receberContato({ jid, telefone, nome, texto: bruto, origem }) {
  const codigo = lerCodigoInvisivel(bruto) || RE_CODIGO.exec(bruto || '')?.[1]?.toUpperCase();
  const clique = codigo && db.prepare("SELECT * FROM lp_clicks WHERE code=? AND created_at >= datetime('now','localtime','-7 days')").get(codigo);
  const texto = semInvisiveis(bruto);
  const c = config();
  const contato = acharContato(jid, telefone);
  const aberto = contato && negocioAberto(contato.id);

  if (clique) {
    const plataforma = plataformaDeUtm(clique.utm_source) || 'lp';
    const rotulo = `Landing page${clique.utm_campaign ? ' · ' + clique.utm_campaign : ''} (código ${clique.code})`;
    const doClique = clique.deal_id && db.prepare("SELECT * FROM deals WHERE id=?").get(clique.deal_id);
    if (doClique) { // preencheu o formulário antes: liga a conversa ao negócio criado
      db.prepare('UPDATE contacts SET wa_jid=COALESCE(wa_jid,?) WHERE id=?').run(jid, doClique.contact_id);
      const primeira = !doClique.last_message;
      if (primeira) registrarInteracao({ contactId: doClique.contact_id, dealId: doClique.id, ownerId: doClique.owner_id, texto: `Mandou mensagem no WhatsApp pela landing page (código ${clique.code}).\n“${texto.slice(0, 500)}”` });
      return registrarRetorno(doClique, { texto, contaRetorno: false });
    }
    if (aberto) return registrarRetorno(aberto, { texto, plataforma, rotulo, contaRetorno: true });
    const id = criarNegocio({ contato, nome: clique.name || nome, telefone: telefone || clique.phone, jid, texto, utm: clique, plataforma, fonte: 'lp' });
    db.prepare('UPDATE lp_clicks SET deal_id=? WHERE code=?').run(id, clique.code);
    return id;
  }
  if (aberto) {
    const horas = aberto.last_message_at ? (Date.now() - new Date(aberto.last_message_at.replace(' ', 'T')).getTime()) / 36e5 : Infinity;
    return registrarRetorno(aberto, { texto, origem, contaRetorno: !!origem || horas >= (c.return_hours || 24) });
  }
  if (c.only_ads && !origem) return null; // só quem veio de anúncio vira lead
  return criarNegocio({ contato, nome, telefone, jid, texto, origem, plataforma: origem?.plataforma, fonte: 'whatsapp' });
}

/** Formulário de landing page / webhook (com UTMs). */
export function leadDeFormulario(b) {
  let tel = so(b.telefone || b.whatsapp || b.phone); if (tel && tel.length <= 11) tel = '55' + tel;
  const jid = tel ? `${tel}@s.whatsapp.net` : null;
  const contato = acharContato(jid, tel); const aberto = contato && negocioAberto(contato.id);
  const plataforma = plataformaDeUtm(b.utm_source) || 'lp';
  if (aberto) { registrarRetorno(aberto, { plataforma, rotulo: `Preencheu a landing page de novo${b.utm_campaign ? ' (' + b.utm_campaign + ')' : ''}`, contaRetorno: true }); return { id: aberto.id, duplicado: true }; }
  const id = criarNegocio({ contato, nome: String(b.nome || '').slice(0, 120) || null, telefone: tel, jid, texto: null, utm: b, plataforma, fonte: 'lp' });
  return { id, duplicado: false };
}

/** Número para onde a landing page manda: o escolhido ou o vinculado. */
export const numeroDaPagina = () => config().lp_number || (e.status === 'conectado' ? e.numero : process.env.LP_NUMERO_TESTE || null);
