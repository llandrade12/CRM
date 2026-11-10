// Esquema compartilhado entre servidor e navegador: entidades, campos, operadores e catálogos.

export const FIELD_TYPES = {
  id: 'Id', text: 'Texto', number: 'Número', money: 'Valor', date: 'Data', user: 'Usuário',
  team: 'Equipe', contact: 'Cliente', option: 'Opção', state: 'Estado', city: 'Cidade',
  status: 'Situação', stage: 'Estágio', pipeline: 'Funil', product: 'Produto',
};

const contactCols = [
  ['contact_name', 'Cliente', 'contact'], ['contact_city', 'Cidade do cliente', 'city'],
  ['contact_state', 'Estado do cliente', 'state'], ['contact_segment', 'Segmento do cliente', 'option'],
];

function docEntity(kind, label, prefix) {
  return {
    key: prefix, label, idField: `${prefix}_id`, dateField: `${prefix}_date`, ownerField: `${prefix}_owner`,
    sql: `SELECT q.id ${prefix}_id, q.number ${prefix}_number, q.title ${prefix}_title, q.total ${prefix}_total,
      q.date ${prefix}_date, q.created_at ${prefix}_create_date,
      CASE q.status WHEN 'open' THEN 'Em aberto' WHEN 'won' THEN 'Ganha' WHEN 'lost' THEN 'Perdida' ELSE q.status END ${prefix}_status,
      os.name ${prefix}_stage, u.name ${prefix}_owner, t.name ${prefix}_team,
      c.name contact_name, c.city contact_city, c.state contact_state, seg.name contact_segment,
      d.title deal_title, s.name deal_stage
      FROM docs q LEFT JOIN users u ON u.id=q.owner_id LEFT JOIN teams t ON t.id=u.team_id
      LEFT JOIN contacts c ON c.id=q.contact_id LEFT JOIN options seg ON seg.id=c.segment_id
      LEFT JOIN deals d ON d.id=q.deal_id LEFT JOIN stages s ON s.id=d.stage_id
      LEFT JOIN options os ON os.id=q.stage_id
      WHERE q.kind='${kind}'`,
    fields: [
      [`${prefix}_id`, 'Id', 'id'], [`${prefix}_number`, 'Número', 'number'], [`${prefix}_title`, 'Título', 'text'],
      [`${prefix}_total`, 'Valor total', 'money'], [`${prefix}_date`, 'Data', 'date'],
      [`${prefix}_create_date`, 'Data de criação', 'date'], [`${prefix}_status`, 'Situação', 'status'],
      [`${prefix}_stage`, 'Estágio', 'option'], [`${prefix}_owner`, 'Responsável', 'user'], [`${prefix}_team`, 'Equipe', 'team'],
      ...contactCols, ['deal_title', 'Negócio', 'text'], ['deal_stage', 'Estágio do negócio', 'stage'],
    ],
  };
}

function itemEntity(kind, label, prefix, parent) {
  return {
    key: prefix, label, idField: `${prefix}_id`, dateField: `${parent}_date`, ownerField: `${parent}_owner`,
    sql: `SELECT i.id ${prefix}_id, p.name ${prefix}_product, g.name product_group, f.name product_family,
      i.qty ${prefix}_qty, i.unit_price ${prefix}_unit_price, i.discount ${prefix}_discount, i.total ${prefix}_total,
      q.number ${parent}_number, q.date ${parent}_date,
      CASE q.status WHEN 'open' THEN 'Em aberto' WHEN 'won' THEN 'Ganha' WHEN 'lost' THEN 'Perdida' ELSE q.status END ${parent}_status,
      u.name ${parent}_owner, c.name contact_name, c.city contact_city, c.state contact_state, seg.name contact_segment
      FROM doc_items i JOIN docs q ON q.id=i.doc_id LEFT JOIN products p ON p.id=i.product_id
      LEFT JOIN options g ON g.id=p.group_id LEFT JOIN options f ON f.id=p.family_id
      LEFT JOIN users u ON u.id=q.owner_id LEFT JOIN contacts c ON c.id=q.contact_id
      LEFT JOIN options seg ON seg.id=c.segment_id WHERE q.kind='${kind}'`,
    fields: [
      [`${prefix}_id`, 'Id', 'id'], [`${prefix}_product`, 'Produto', 'product'], ['product_group', 'Grupo do produto', 'option'],
      ['product_family', 'Família do produto', 'option'], [`${prefix}_qty`, 'Quantidade', 'number'],
      [`${prefix}_unit_price`, 'Valor unitário', 'money'], [`${prefix}_discount`, 'Desconto (%)', 'number'],
      [`${prefix}_total`, 'Total', 'money'], [`${parent}_number`, 'Número do documento', 'number'],
      [`${parent}_date`, 'Data', 'date'], [`${parent}_status`, 'Situação', 'status'], [`${parent}_owner`, 'Responsável', 'user'],
      ...contactCols,
    ],
  };
}

export const ENTITIES = {
  contact: {
    key: 'contact', label: 'Cliente', idField: 'contact_id', dateField: 'contact_create_date', ownerField: 'contact_owner',
    sql: `SELECT c.id contact_id, c.name contact_name, CASE c.type WHEN 'company' THEN 'Empresa' ELSE 'Pessoa' END contact_type,
      c.doc contact_doc, c.email contact_email, c.phone contact_phone, c.city contact_city, c.state contact_state,
      c.created_at contact_create_date, c.last_contact_at contact_last_contact, seg.name contact_segment,
      ori.name contact_origin, st.name contact_status, u.name contact_owner, t.name contact_team, co.name contact_company
      FROM contacts c LEFT JOIN options seg ON seg.id=c.segment_id LEFT JOIN options ori ON ori.id=c.origin_id
      LEFT JOIN options st ON st.id=c.status_id LEFT JOIN users u ON u.id=c.owner_id LEFT JOIN teams t ON t.id=u.team_id
      LEFT JOIN contacts co ON co.id=c.company_id`,
    fields: [
      ['contact_id', 'Id', 'id'], ['contact_name', 'Nome', 'contact'], ['contact_type', 'Tipo', 'option'],
      ['contact_doc', 'CPF/CNPJ', 'text'], ['contact_email', 'E-mail', 'text'], ['contact_phone', 'Telefone', 'text'],
      ['contact_city', 'Cidade', 'city'], ['contact_state', 'Estado', 'state'], ['contact_create_date', 'Data de criação', 'date'],
      ['contact_last_contact', 'Data do último contato', 'date'], ['contact_segment', 'Segmento', 'option'],
      ['contact_origin', 'Origem', 'option'], ['contact_status', 'Status', 'option'], ['contact_owner', 'Responsável', 'user'],
      ['contact_team', 'Equipe', 'team'], ['contact_company', 'Empresa', 'contact'],
    ],
  },
  deal: {
    key: 'deal', label: 'Negócio', idField: 'deal_id', dateField: 'deal_create_date', ownerField: 'deal_owner',
    sql: `SELECT d.id deal_id, d.title deal_title, d.amount deal_amount, d.created_at deal_create_date,
      d.start_date deal_start_date, d.end_date deal_end_date, d.closed_at deal_close_date,
      CASE d.status WHEN 'open' THEN 'Em andamento' WHEN 'won' THEN 'Ganho' ELSE 'Perdido' END deal_status,
      s.name deal_stage, p.name deal_pipeline, u.name deal_owner, t.name deal_team, o.name deal_origin,
      lr.name deal_loss_reason, CAST(julianday('now')-julianday(d.stage_changed_at) AS INTEGER) deal_days_in_stage,
      c.name contact_name, c.city contact_city, c.state contact_state, seg.name contact_segment,
      CASE d.source WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'lp' THEN 'Landing page' ELSE 'Cadastro manual' END deal_lead_source,
      CASE d.platform WHEN 'instagram' THEN 'Instagram' WHEN 'facebook' THEN 'Facebook' WHEN 'meta' THEN 'Meta' WHEN 'google' THEN 'Google' WHEN 'lp' THEN 'Landing page' END deal_platform,
      d.ad_title deal_ad_title, d.utm_source deal_utm_source, d.utm_campaign deal_utm_campaign, d.returns deal_returns
      FROM deals d LEFT JOIN stages s ON s.id=d.stage_id LEFT JOIN pipelines p ON p.id=d.pipeline_id
      LEFT JOIN users u ON u.id=d.owner_id LEFT JOIN teams t ON t.id=u.team_id LEFT JOIN options o ON o.id=d.origin_id
      LEFT JOIN options lr ON lr.id=d.loss_reason_id LEFT JOIN contacts c ON c.id=d.contact_id
      LEFT JOIN options seg ON seg.id=c.segment_id`,
    fields: [
      ['deal_id', 'Id', 'id'], ['deal_title', 'Título', 'text'], ['deal_amount', 'Valor', 'money'],
      ['deal_create_date', 'Data de criação', 'date'], ['deal_start_date', 'Início', 'date'], ['deal_end_date', 'Término', 'date'], ['deal_close_date', 'Data de fechamento', 'date'],
      ['deal_status', 'Situação', 'status'], ['deal_stage', 'Estágio', 'stage'], ['deal_pipeline', 'Funil', 'pipeline'],
      ['deal_owner', 'Responsável', 'user'], ['deal_team', 'Equipe', 'team'], ['deal_origin', 'Origem', 'option'],
      ['deal_loss_reason', 'Motivo de perda', 'option'], ['deal_days_in_stage', 'Dias no estágio', 'number'],
      ['deal_lead_source', 'Entrada do lead', 'option'], ['deal_platform', 'Plataforma do anúncio', 'option'], ['deal_ad_title', 'Anúncio', 'text'],
      ['deal_utm_source', 'UTM source', 'text'], ['deal_utm_campaign', 'UTM campaign', 'text'], ['deal_returns', 'Retornos do lead', 'number'], ...contactCols,
    ],
  },
  quote: docEntity('quote', 'Proposta', 'quote'),
  quote_item: itemEntity('quote', 'Produto da proposta', 'quote_item', 'quote'),
  order: docEntity('order', 'Venda', 'order'),
  order_item: itemEntity('order', 'Produto da venda', 'order_item', 'order'),
  document: docEntity('document', 'Documento', 'document'),
  product: {
    key: 'product', label: 'Produto', idField: 'product_id', dateField: 'product_create_date', ownerField: null,
    sql: `SELECT p.id product_id, p.name product_name, p.code product_code, p.price product_price, p.unit product_unit,
      p.created_at product_create_date, g.name product_group, f.name product_family
      FROM products p LEFT JOIN options g ON g.id=p.group_id LEFT JOIN options f ON f.id=p.family_id`,
    fields: [
      ['product_id', 'Id', 'id'], ['product_name', 'Nome', 'product'], ['product_code', 'Código', 'text'],
      ['product_price', 'Preço', 'money'], ['product_unit', 'Unidade', 'text'], ['product_create_date', 'Data de criação', 'date'],
      ['product_group', 'Grupo', 'option'], ['product_family', 'Família', 'option'],
    ],
  },
  task: {
    key: 'task', label: 'Tarefa', idField: 'task_id', dateField: 'task_date', ownerField: 'task_owner',
    sql: `SELECT k.id task_id, k.title task_title, k.date task_date, k.time task_time, k.created_at task_create_date,
      k.done_at task_done_date, CASE k.done WHEN 1 THEN 'Finalizada' ELSE 'Aberta' END task_status, ty.name task_type,
      u.name task_owner, t.name task_team, c.name contact_name, c.city contact_city, c.state contact_state, d.title deal_title
      FROM tasks k LEFT JOIN options ty ON ty.id=k.type_id LEFT JOIN users u ON u.id=k.owner_id LEFT JOIN teams t ON t.id=u.team_id
      LEFT JOIN contacts c ON c.id=k.contact_id LEFT JOIN deals d ON d.id=k.deal_id`,
    fields: [
      ['task_id', 'Id', 'id'], ['task_title', 'Título', 'text'], ['task_date', 'Data', 'date'], ['task_time', 'Horário', 'text'],
      ['task_create_date', 'Data de criação', 'date'], ['task_done_date', 'Data de finalização', 'date'],
      ['task_status', 'Situação', 'status'], ['task_type', 'Tipo', 'option'], ['task_owner', 'Responsável', 'user'],
      ['task_team', 'Equipe', 'team'], ['contact_name', 'Cliente', 'contact'], ['contact_city', 'Cidade do cliente', 'city'],
      ['contact_state', 'Estado do cliente', 'state'], ['deal_title', 'Negócio', 'text'],
    ],
  },
  interaction: {
    key: 'interaction', label: 'Registro de interação', idField: 'interaction_id', dateField: 'interaction_date', ownerField: 'interaction_owner',
    sql: `SELECT r.id interaction_id, r.date interaction_date, r.description interaction_description, ty.name interaction_type,
      u.name interaction_owner, t.name interaction_team, c.name contact_name, c.city contact_city, c.state contact_state,
      seg.name contact_segment, d.title deal_title
      FROM interactions r LEFT JOIN options ty ON ty.id=r.type_id LEFT JOIN users u ON u.id=r.owner_id
      LEFT JOIN teams t ON t.id=u.team_id LEFT JOIN contacts c ON c.id=r.contact_id
      LEFT JOIN options seg ON seg.id=c.segment_id LEFT JOIN deals d ON d.id=r.deal_id`,
    fields: [
      ['interaction_id', 'Id', 'id'], ['interaction_date', 'Data', 'date'], ['interaction_description', 'Descrição', 'text'],
      ['interaction_type', 'Tipo', 'option'], ['interaction_owner', 'Responsável', 'user'], ['interaction_team', 'Equipe', 'team'],
      ...contactCols, ['deal_title', 'Negócio', 'text'],
    ],
  },
  user: {
    key: 'user', label: 'Usuário', idField: 'user_id', dateField: 'user_create_date', ownerField: 'user_name',
    sql: `SELECT u.id user_id, u.name user_name, u.email user_email, u.role user_role, u.title user_title,
      u.created_at user_create_date, t.name user_team FROM users u LEFT JOIN teams t ON t.id=u.team_id`,
    fields: [
      ['user_id', 'Id', 'id'], ['user_name', 'Nome', 'user'], ['user_email', 'E-mail', 'text'], ['user_role', 'Perfil', 'option'],
      ['user_title', 'Cargo', 'text'], ['user_create_date', 'Data de criação', 'date'], ['user_team', 'Equipe', 'team'],
    ],
  },
};
for (const e of Object.values(ENTITIES)) e.fieldMap = Object.fromEntries(e.fields.map(([k, l, t]) => [k, { key: k, label: l, type: t }]));

export const NUMERIC = new Set(['number', 'money', 'id']);

export const AGGREGATORS = [
  { id: 'count', label: 'Contagem' }, { id: 'sum', label: 'Soma' }, { id: 'avg', label: 'Média' },
  { id: 'max', label: 'Valor máximo' }, { id: 'min', label: 'Valor mínimo' },
];

export const MODIFIERS = [
  { id: 'day', label: 'Dia' }, { id: 'week', label: 'Semana' }, { id: 'weekday', label: 'Dia da semana' },
  { id: 'month', label: 'Mês' }, { id: 'bimester', label: 'Bimestre' }, { id: 'quarter', label: 'Trimestre' },
  { id: 'quadrimester', label: 'Quadrimestre' }, { id: 'semester', label: 'Semestre' }, { id: 'year', label: 'Ano' },
  { id: 'hour', label: 'Hora' },
];

export const OPERATORS = [
  { id: 1, label: 'Igual a' }, { id: 2, label: 'Diferente de' }, { id: 3, label: 'Maior que' },
  { id: 4, label: 'Maior ou igual a' }, { id: 5, label: 'Menor que' }, { id: 6, label: 'Menor ou igual a' },
  { id: 7, label: 'Contém' }, { id: 8, label: 'Não contém' }, { id: 9, label: 'Intervalo' },
  { id: 10, label: 'Vazio' }, { id: 11, label: 'Não vazio' },
];
export function operatorsFor(type) {
  if (type === 'date' || NUMERIC.has(type)) return [1, 2, 3, 4, 5, 6, 9, 10, 11];
  if (type === 'text') return [1, 2, 7, 8, 10, 11];
  return [1, 2, 7, 8, 10, 11];
}

// Datas relativas: n=true pede um número N
export const RELATIVE_DATES = [
  ['today', 'Hoje'], ['yesterday', 'Ontem'], ['thisweek', 'Esta semana'], ['last7days', 'Últimos 7 dias'],
  ['lastweek', 'Semana passada'], ['thismonth', 'Este mês'], ['last30days', 'Últimos 30 dias'], ['lastmonth', 'Mês passado'],
  ['lastndays', 'Últimos N dias', 1], ['lastnweeks', 'Últimas N semanas', 1], ['lastnmonths', 'Últimos N meses', 1],
  ['nextndays', 'Próximos N dias', 1], ['nextnweeks', 'Próximas N semanas', 1], ['nextnmonths', 'Próximos N meses', 1],
  ['thisyear', 'Este ano'], ['lastyear', 'Ano passado'], ['thisquarter', 'Este trimestre'], ['thissemester', 'Este semestre'],
  ['lastnquarters', 'Últimos N trimestres', 1], ['lastnsemesters', 'Últimos N semestres', 1],
  ['nextnquarters', 'Próximos N trimestres', 1], ['nextnsemesters', 'Próximos N semestres', 1],
  ['lastnyears', 'Últimos N anos', 1], ['nextnyears', 'Próximos N anos', 1], ['ndaysago', 'N dias atrás', 1],
  ['nweeksago', 'N semanas atrás', 1], ['nmonthsago', 'N meses atrás', 1], ['nquartersago', 'N trimestres atrás', 1],
  ['nsemestersago', 'N semestres atrás', 1], ['nyearsago', 'N anos atrás', 1], ['lastquarter', 'Trimestre passado'],
  ['lastsemester', 'Semestre passado'],
].map(([id, label, n]) => ({ id, label, n: !!n }));

export const CHART_TYPES = [
  { id: 'area', label: 'Gráfico de área', icon: '◭', minM: 1, maxM: 10, maxD: 1, metricName: 'Área' },
  { id: 'bar', label: 'Gráfico de barra', icon: 'ph:chart-bar', minM: 1, maxM: 10, maxD: 1, metricName: 'Barra' },
  { id: 'hbar', label: 'Barra horizontal', icon: 'ph:chart-bar-horizontal', minM: 1, maxM: 10, maxD: 1, metricName: 'Barra' },
  { id: 'line', label: 'Gráfico de linha', icon: 'ph:chart-line', minM: 1, maxM: 10, maxD: 1, metricName: 'Linha' },
  { id: 'pie', label: 'Gráfico de pizza', icon: 'ph:chart-pie-slice', minM: 1, maxM: 1, maxD: 1, metricName: 'Métrica' },
  { id: 'donut', label: 'Gráfico de donut', icon: 'ph:chart-donut', minM: 1, maxM: 1, maxD: 1, metricName: 'Métrica' },
  { id: 'funnel', label: 'Gráfico de funil', icon: 'ph:funnel', minM: 1, maxM: 1, maxD: 1, metricName: 'Métrica' },
  { id: 'indicator', label: 'Indicador', icon: 'ph:hash', minM: 1, maxM: 1, maxD: 0, metricName: 'Métrica' },
  { id: 'map', label: 'Mapa (estados)', icon: 'ph:map-trifold', minM: 1, maxM: 1, maxD: 1, metricName: 'Região', forceDim: 'state' },
  { id: 'table', label: 'Tabela', icon: 'ph:table', minM: 1, maxM: 15, maxD: 2, metricName: 'Coluna' },
  { id: 'funnel_history', label: 'Análise histórica do funil', icon: 'ph:percent', minM: 0, maxM: 0, maxD: 0, metricName: '' },
];
export const chartType = id => CHART_TYPES.find(t => t.id === id);

// Filtros de painel: tipo → tipos de campo compatíveis
export const PANEL_FILTER_TYPES = [
  { id: 'user', label: 'Usuário', fieldTypes: ['user'] }, { id: 'team', label: 'Equipe', fieldTypes: ['team'] },
  { id: 'contact', label: 'Cliente', fieldTypes: ['contact'] }, { id: 'date', label: 'Data', fieldTypes: ['date'] },
  { id: 'text', label: 'Texto', fieldTypes: ['text'] }, { id: 'number', label: 'Valor numérico', fieldTypes: ['number', 'money'] },
  { id: 'city', label: 'Cidade', fieldTypes: ['city'] }, { id: 'state', label: 'Estado', fieldTypes: ['state'] },
  { id: 'option', label: 'Opções pré-cadastradas', fieldTypes: ['option', 'status', 'stage', 'pipeline'] },
  { id: 'product', label: 'Produto', fieldTypes: ['product'] },
];

// Séries dos gráficos: abre com o laranja da marca e tons derivados da paleta Crmdss (legíveis no claro e no escuro)
export const PALETTE = ['#fca311', '#3a5a9b', '#8d99ae', '#e76f51', '#2a9d8f', '#7b6d8d', '#f4d35e', '#5c8fd6', '#b56576', '#16a34a', '#c97c10', '#dc2626'];

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
