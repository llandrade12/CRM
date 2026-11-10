// Crmdss — deixa o banco pronto para uso real: apaga os dados de demonstração e mantém a estrutura.
// Uso: npm run limpar   (faz backup em data/backup-antes-de-limpar-<data>.db antes de mexer)
//
// Apaga: clientes, negócios e histórico, propostas/vendas/documentos, produtos, tarefas, interações,
//        metas (alvos fictícios), registros de atividade, cliques da landing page,
//        os 5 vendedores fictícios (@lente.local), as equipes fictícias e os dados da empresa fictícia,
//        e as opções próprias da empresa de exemplo (segmentos, grupos e famílias de produto).
// Mantém: o Administrador (com a senha atual), usuários reais criados por você, equipes criadas por você,
//         funis e estágios, painéis de relatório, abas salvas, opções genéricas (origens, status, motivos
//         de perda, tipos de tarefa/interação, estágios da venda, marcadores) e a configuração do WhatsApp.
import fs from 'node:fs';
import path from 'node:path';

const VENDEDORES_FICTICIOS = ['marina@lente.local', 'rafael@lente.local', 'juliana@lente.local', 'bruno@lente.local', 'camila@lente.local'];
const EQUIPES_FICTICIAS = ['Comercial Interno', 'Field Sales'];
const OPCOES_DO_EXEMPLO = ['segment', 'product_group', 'product_family'];
const TABELAS_DE_DADOS = ['contacts', 'deals', 'deal_history', 'docs', 'doc_items', 'products', 'tasks', 'interactions', 'goals', 'logs', 'lp_clicks'];

export function limparDados(db) {
  const existe = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const tabelas = TABELAS_DE_DADOS.filter(existe); // lp_clicks só existe depois que o módulo do WhatsApp sobe
  const antes = Object.fromEntries(tabelas.map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
  db.exec('BEGIN');
  try {
    for (const t of tabelas) db.exec(`DELETE FROM ${t}`);
    const marca = VENDEDORES_FICTICIOS.map(() => '?').join(',');
    const usuarios = db.prepare(`DELETE FROM users WHERE lower(email) IN (${marca}) AND id <> 1`).run(...VENDEDORES_FICTICIOS).changes;
    const equipes = db.prepare(`DELETE FROM teams WHERE name IN (${EQUIPES_FICTICIAS.map(() => '?').join(',')})`).run(...EQUIPES_FICTICIAS).changes;
    db.exec('UPDATE users SET team_id = NULL WHERE team_id NOT IN (SELECT id FROM teams)');
    const opcoes = db.prepare(`DELETE FROM options WHERE kind IN (${OPCOES_DO_EXEMPLO.map(() => '?').join(',')})`).run(...OPCOES_DO_EXEMPLO).changes;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('company', ?)").run(JSON.stringify({ name: '' }));
    db.prepare("UPDATE tabs SET name = 'Todas' WHERE name = 'Registros de interação'").run();
    db.exec('COMMIT');
    return { antes, usuarios, equipes, opcoes };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Execução direta: node limpar.js
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const { openDb, DB_PATH } = await import('./db.js');
  if (!fs.existsSync(DB_PATH)) { console.log('Nenhum banco em', DB_PATH, '— ao iniciar, o sistema já cria um banco limpo.'); process.exit(); }
  const db = openDb();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const copia = path.join(path.dirname(DB_PATH), `backup-antes-de-limpar-${carimbo}.db`);
  db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
  const r = limparDados(db);
  db.exec('VACUUM');
  console.log('Backup salvo em', copia);
  console.log('Apagado:', Object.entries(r.antes).map(([t, n]) => `${t} ${n}`).join(', '));
  console.log(`Usuários fictícios: ${r.usuarios} · equipes fictícias: ${r.equipes} · opções do exemplo: ${r.opcoes}`);
}
