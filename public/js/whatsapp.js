// Tela WhatsApp: vinculação (QR Code / código de 8 dígitos), regras de entrada dos leads,
// leads recebidos, landing page de rastreio e simulador. Trazido do CRM de Tráfego.
import { h, clear, api, state, toast, guard, confirmDialog, sel, field, dateTime, num } from './ui.js';

let modo = 'qr';
const telBR = t => { const d = String(t || '').replace(/\D/g, '').replace(/^55/, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : d; };
export const PLAT = { instagram: ['IG', 'Instagram', 'var(--brand-ig)'], facebook: ['FB', 'Facebook', 'var(--brand-fb)'], meta: ['META', 'Meta Ads', 'var(--brand-meta)'], google: ['G', 'Google', 'var(--brand-google)'], lp: ['LP', 'Landing page', 'var(--text-2)'] };
export const chipOrigem = (plat, source) => {
  // origem do lead: ponto na cor da plataforma + nome, discreto (a cor só identifica, não grita)
  const p = PLAT[plat] || (source === 'lp' ? PLAT.lp : source === 'whatsapp' ? ['WA', 'WhatsApp', 'var(--brand-wa)'] : null);
  return p ? h('span.src', { title: `Origem: ${p[1]}`, style: { '--src': p[2] } }, p[1]) : null;
};

export async function whatsappPage(content) {
  const p = h('div.page'); content.append(p);
  const statusEl = h('span');
  const corpo = h('div', { style: { minHeight: '300px', display: 'grid', placeItems: 'center', textAlign: 'center' } });
  const data = await api('/whatsapp');
  p.append(h('div.pagehead', h('h1', 'WhatsApp'), statusEl));
  const kpis = h('div.kpis');
  const desenharKpis = s => { clear(kpis).append(...[['Leads do WhatsApp', s.total], ['Neste mês', s.mes], ['De anúncio Instagram', s.ig], ['De anúncio Facebook', s.fb], ['Da landing page', s.lp], ['Retornos registrados', s.retornos]]
    .map(([l, v]) => h('div.card.kpi', h('div.l', l), h('div.v', num(v || 0))))); };
  desenharKpis(data.stats);

  // ----- vinculação -----
  const vinc = h('div.card', h('div.hd', h('h3', 'Vincular número'), statusEl.cloneNode()), h('div.bd', corpo));
  const ajuda = h('div.card', h('div.hd', h('h3', 'Como vincular')), h('div.bd',
    h('ol', { style: { paddingLeft: '20px', lineHeight: 1.8, margin: 0 } },
      h('li', 'No celular com o número da empresa, abra o ', h('b', 'WhatsApp Business'), '.'),
      h('li', 'Toque em ', h('b', '⋮ Mais opções'), ' (Android) ou ', h('b', 'Configurações'), ' (iPhone).'),
      h('li', 'Toque em ', h('b', 'Dispositivos conectados → Conectar dispositivo'), '.'),
      h('li', 'Aponte a câmera para o QR Code ou toque em ', h('b', '“Conectar com número de telefone”'), ' e digite o código.')),
    h('h4', { style: { margin: '14px 0 6px' } }, 'O que o CRM faz com o WhatsApp'),
    h('ul.muted', { style: { paddingLeft: '20px', lineHeight: 1.7, margin: 0 } },
      h('li', 'Só ', h('b', 'lê'), ' as mensagens novas para criar e atualizar os negócios.'),
      h('li', h('b', 'Não envia'), ' mensagens, não marca como lida e não aparece “online”.'),
      h('li', 'Quem chama vira ', h('b', 'Cliente + Negócio'), ' no funil escolhido abaixo, com a origem do anúncio.'),
      h('li', 'Quem já tem negócio aberto e volta a chamar fica no estágio atual; o retorno é registrado.'),
      h('li', 'A sessão fica salva: reiniciar o servidor não exige escanear de novo.'))));
  // Vincular número, regras, landing page e simulador: só administradores (o servidor também bloqueia).
  const adm = (...els) => { if (data.admin) p.append(...els); };
  p.append(kpis);
  if (data.admin) p.append(h('div.grid2', vinc, ajuda));
  else p.append(h('div.card', { style: { marginTop: '14px' } }, h('div.bd', h('p.muted', { style: { margin: 0 } }, 'Vincular o número, mudar as regras de entrada e ver o link da landing page são tarefas do administrador. Abaixo estão os leads que chegaram.'))));

  const rot = { desconectado: ['Desconectado', ''], conectando: ['Conectando…', 'open'], aguardando_qr: ['Aguardando leitura', 'open'], aguardando_codigo: ['Aguardando código', 'open'], conectado: ['Conectado', 'won'], erro: ['Erro', 'lost'] };
  function desenhar(st) {
    const [l, c] = rot[st.status] || [st.status, ''];
    p.querySelectorAll('.wa-status').forEach(x => x.remove());
    vinc.querySelector('.hd').append(h(`span.badge.wa-status${c ? '.' + c : ''}`, `● ${l}`));
    clear(corpo);
    if (st.status === 'conectado') {
      corpo.append(h('div', h('div', { style: { fontSize: '44px', color: 'var(--ok)' } }, '✔'), h('h3', 'WhatsApp vinculado'),
        h('p.muted', `Número ${telBR(st.numero) || st.numero}`, h('br'), 'Os novos leads vão aparecer no funil automaticamente.'),
        h('button.btn.danger', { on: { click: guard(async () => { if (await confirmDialog('Desvincular o WhatsApp? O CRM para de receber leads até vincular de novo.', 'Desvincular')) await api('/whatsapp/desconectar', { body: {} }); }) } }, 'Desvincular')));
      return;
    }
    const cancelar = h('button.btn.sm', { on: { click: () => api('/whatsapp/desconectar', { body: { desvincular: false } }) } }, 'Cancelar');
    if (st.status === 'aguardando_qr' && st.qr) return corpo.append(h('div', h('img', { src: st.qr, alt: 'QR Code para vincular o WhatsApp', style: { width: '260px', background: '#fff', padding: '8px', borderRadius: '10px' } }), h('p.muted.small', 'O QR Code se renova sozinho a cada ~20 segundos.'), cancelar));
    if (st.status === 'aguardando_codigo' && st.codigo) return corpo.append(h('div', h('p', 'Digite este código no celular:'), h('div', { style: { fontSize: '32px', fontWeight: 700, letterSpacing: '.12em', background: 'var(--accbg)', color: 'var(--acc)', borderRadius: '10px', padding: '10px 18px' } }, st.codigo),
      h('p.muted.small', 'WhatsApp → Dispositivos conectados → Conectar dispositivo → ', h('b', 'Conectar com número de telefone')), cancelar));
    if (st.status === 'conectando') return corpo.append(h('div', h('p.muted', 'Falando com o WhatsApp…')));
    const tel = h('input.i', { inputmode: 'tel', placeholder: '55 71 99999-8888' });
    corpo.append(h('div.col', { style: { width: '100%', maxWidth: '340px' } },
      h('div.tabsbar', { style: { justifyContent: 'center' } }, [['qr', 'QR Code'], ['codigo', 'Código de 8 dígitos']].map(([k, l]) => h(`span.tab${modo === k ? '.on' : ''}`, { on: { click: () => { modo = k; desenhar({ ...st, erro: null }); } } }, l))),
      modo === 'codigo' ? field('Número do WhatsApp da empresa (com DDI)', tel) : h('p.muted', 'Gere o QR Code e escaneie com o celular da empresa.'),
      st.erro ? h('div', { style: { color: 'var(--bad)' } }, st.erro) : null,
      h('button.btn.pri', { style: { justifyContent: 'center' }, on: { click: guard(async e => { e.target.disabled = true; desenhar(await api('/whatsapp/conectar', { body: { modo, telefone: tel.value } })); }) } }, modo === 'qr' ? 'Gerar QR Code' : 'Gerar código')));
  }
  desenhar(data);
  const ouvir = ev => { if (!corpo.isConnected) return window.removeEventListener('lente:wa', ouvir); if (ev.detail.tipo === 'whatsapp') desenhar(ev.detail); };
  window.addEventListener('lente:wa', ouvir);

  // ----- regras de entrada -----
  const c = data.config;
  const pipes = state.meta.pipelines.filter(x => !x.archived);
  const pipeSel = sel(pipes, c.pipeline_id || pipes[0]?.id, { empty: null });
  const stageSel = h('select.i');
  const fillStages = () => { clear(stageSel); (pipes.find(x => x.id === +pipeSel.value)?.stages || []).forEach(s => stageSel.append(h('option', { value: s.id, selected: s.id === c.stage_id }, s.name))); };
  pipeSel.addEventListener('change', fillStages); fillStages();
  const owner = sel(state.meta.users.filter(u => u.active), c.owner_id, { empty: 'Administrador (padrão)' });
  const onlyAds = sel([{ id: 1, name: 'Só quem veio de anúncio (Clique para WhatsApp) ou da landing page' }, { id: 0, name: 'Qualquer pessoa que mandar mensagem' }], c.only_ads ? 1 : 0, { empty: null });
  const horas = h('input.i', { type: 'number', min: 1, value: c.return_hours });
  const lpNum = h('input.i', { inputmode: 'tel', value: telBR(c.lp_number), placeholder: data.numero ? `Vazio = ${telBR(data.numero)} (vinculado)` : 'Ex.: 71 98764-2917' });
  const lpMsg = h('input.i', { value: c.lp_message, maxLength: 300 });
  const salvar = guard(async () => {
    await api('/whatsapp/config', { method: 'PUT', body: { only_ads: +onlyAds.value === 1, pipeline_id: pipeSel.value, stage_id: stageSel.value, owner_id: owner.value, return_hours: horas.value, lp_number: lpNum.value, lp_message: lpMsg.value } });
    toast('Configuração salva');
  });
  adm(h('div.card', { style: { marginTop: '14px' } }, h('div.hd', h('h3', 'Regras de entrada dos leads'), h('button.btn.pri.sm', { on: { click: salvar } }, 'Salvar')),
    h('div.bd.grid3', field('Quem vira lead', onlyAds), field('Funil de destino', pipeSel), field('Estágio inicial', stageSel), field('Responsável pelos novos leads', owner),
      field('Conta como “voltou” após (horas sem falar)', horas))));

  // ----- leads recebidos -----
  const lista = h('div');
  async function carregarLeads() {
    const [ls, st] = await Promise.all([api('/whatsapp/leads'), api('/whatsapp')]);
    desenharKpis(st.stats); clear(lista);
    if (!ls.length) return lista.append(h('div.tablewrap', h('div.empty', data.admin ? 'Nenhum lead do WhatsApp ainda. Vincule o número ou use o simulador abaixo.' : 'Nenhum lead do WhatsApp ainda. Eles aparecem aqui assim que chegarem.')));
    lista.append(h('div.tablewrap', h('table.t', h('thead', h('tr', ['Origem', 'Negócio', 'Cliente', 'Anúncio / campanha', 'Estágio', 'Retornos', 'Última mensagem', 'Quando'].map(x => h('th', x)))),
      h('tbody', ls.map(d => h('tr.click', { on: { click: () => { location.hash = `#/negocio/${d.id}`; } } }, h('td', chipOrigem(d.platform, d.source)), h('td', d.title), h('td', d.contact_name || ''),
        h('td.small', d.ad_title || d.utm_campaign || '—', d.recent_ad_title ? h('div.muted', `Recente: ${d.recent_ad_title}`) : null), h('td', d.stage_name || ''), h('td.num', d.returns || 0),
        h('td.small', String(d.last_message || '').slice(0, 70)), h('td.nowrap.small', dateTime(d.last_message_at || d.created_at))))))));
  }
  p.append(h('h3', { style: { margin: '18px 0 8px' } }, 'Leads recebidos pelo WhatsApp'), lista);
  carregarLeads();
  const recarregar = ev => { if (!lista.isConnected) return window.removeEventListener('lente:wa', recarregar); if (ev.detail.tipo === 'lead') carregarLeads(); };
  window.addEventListener('lente:wa', recarregar);

  // ----- landing page e webhook -----
  const base = data.rede.enderecos[0] || location.origin;
  const lpLink = `${base}/lp/${c.lp_token}?utm_source=instagram&utm_medium=teste&utm_campaign=teste-whatsapp`;
  adm(h('div.grid2', { style: { marginTop: '14px' } },
    h('div.card', h('div.hd', h('h3', 'Landing page de rastreio')), h('div.bd.col',
      h('p.muted', { style: { margin: 0 } }, 'A pessoa toca no botão e o WhatsApp abre com a mensagem pronta e um código de rastreio invisível. Quando ela envia, o negócio aparece no funil com a origem e as UTMs do link.'),
      field('Link da página (troque as UTMs por campanha)', h('div.row', h('input.i', { value: lpLink, readOnly: true }), h('button.btn.sm', { on: { click: () => { navigator.clipboard?.writeText(lpLink); toast('Link copiado'); } } }, 'Copiar'), h('a.btn.sm', { href: lpLink, target: '_blank', rel: 'noopener' }, 'Abrir'))),
      field('Número do WhatsApp da página', lpNum), field('Mensagem pronta ({nome} = “, sou Fulano”)', lpMsg),
      h('div', h('button.btn.pri.sm', { on: { click: salvar } }, 'Salvar')),
      !data.rede.enderecos.length ? h('p.small.muted', '📱 Para abrir no celular (mesmo Wi-Fi), inicie o servidor com ', h('code', 'HOST=0.0.0.0 npm start'), '.') : null)),
    h('div.card', h('div.hd', h('h3', 'Webhook de formulário (Elementor etc.)')), h('div.bd.col',
      h('p.muted', { style: { margin: 0 } }, 'Envie os formulários das suas landing pages para este endereço. Campos: nome, telefone, utm_source, utm_medium, utm_campaign, utm_content, utm_term.'),
      h('input.i', { value: `POST ${base}/api/webhook/lp/${c.lp_token}`, readOnly: true }),
      h('p.small.muted', 'Telefone que já tem negócio aberto não duplica: registra que voltou.')))));

  // ----- simulador -----
  const simNome = h('input.i', { value: 'Lead de teste' }), simTel = h('input.i', { placeholder: 'Vazio = número aleatório' });
  const simTexto = h('input.i', { value: 'Olá! Vi o anúncio e quero saber mais.' }), simAnuncio = h('input.i', { value: 'Avaliação gratuita' });
  const simCod = h('input.i', { placeholder: 'Ex.: LP-7F3K2 (opcional)' });
  const simular = tipo => guard(async () => {
    const r = await api('/whatsapp/simular', { body: { tipo: tipo.startsWith('anuncio') ? 'anuncio' : 'sem', plataforma: tipo === 'anuncio-fb' ? 'facebook' : 'instagram', nome: simNome.value, telefone: simTel.value, texto: simTexto.value, anuncio_titulo: simAnuncio.value, codigo: simCod.value } });
    toast(r.ignorado ? 'Ignorado: “só anúncios” está ligado e a mensagem não veio de anúncio' : 'Mensagem recebida');
  });
  adm(h('div.card', { style: { marginTop: '14px' } }, h('div.hd', h('h3', 'Simular mensagem (teste sem celular)')), h('div.bd.col',
    h('div.grid3', field('Nome no WhatsApp', simNome), field('Telefone (com DDI)', simTel), field('Mensagem', simTexto), field('Título do anúncio', simAnuncio), field('Código da landing page', simCod)),
    h('div.row.wrap', h('button.btn', { on: { click: simular('anuncio') } }, 'Simular anúncio Instagram'), h('button.btn', { on: { click: simular('anuncio-fb') } }, 'Simular anúncio Facebook'),
      h('button.btn', { on: { click: simular('sem') } }, 'Simular mensagem comum (sem anúncio / com código)')),
    h('p.small.muted', { style: { margin: 0 } }, 'Usar o mesmo telefone duas vezes mostra a regra de retorno: o negócio não duplica e o retorno é registrado.'))));
}
