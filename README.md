# Crmdss (antigo Lente CRM)

Marca: logo em `logo/` (SVG + PNG). Paleta: #000000 · #14213D · #FCA311 · #E5E5E5 · #FFFFFF. Prints de cada página em `prints-crmdss/` (tema escuro em `prints-crmdss/tema-escuro/`).

CRM próprio com a estrutura de funcionalidades mapeada (foco em Relatórios). Node 24, sem dependências de servidor.

## Rodar
    cd ~/lente-crm
    npm start              # http://localhost:3090
    npm run limpar         # apaga os dados de exemplo e mantém a estrutura (faz backup antes)
    npm run seed           # recria o banco com dados de demonstração (apaga tudo)

Uma instalação nova começa limpa, só com o Administrador. Para começar com dados de exemplo, inicie com `CRM_DEMO=1`.

Primeiro acesso: admin@lente.local / admin123 — o sistema pede para criar uma senha nova na hora.
Banco: data/lente.db (SQLite). Log do servidor: data/server.log.

## Módulos
- Resumo e Metas (intervalos diário…anual, por usuário/equipe, histórico de 6 intervalos)
- Clientes (empresas/pessoas, abas com filtros salvos, filtro avançado E/OU, CSV, importação, ficha com linha do tempo)
- Negócios (kanban com arrastar, vários funis, estágios com checklist, ganhar/perder com motivo, visão tabela)
- Documentos (propostas com revisões, vendas, documentos, itens com desconto, impressão/PDF, gerar venda)
- Produtos (grupos, famílias), Tarefas (lista, calendário, tabela, recorrência), Interações
- Relatórios: painéis, 11 tipos de gráfico, métricas (módulo, agregador, campo, filtro, dimensões e intervalo de data),
  pré-visualização ao vivo, grade arrastável/redimensionável, filtros de painel mapeados por métrica, drill-down,
  exportação CSV, apresentação, cache de 10 min, duplicar/mover gráficos e painéis, análise histórica do funil
- Usuários, equipes, opções pré-cadastradas, automações (criar tarefa), log de alterações, modelo de documento

## WhatsApp (trazido do CRM de Tráfego)
Tela **WhatsApp** no menu. O CRM entra como "dispositivo conectado" (Baileys) por **QR Code** ou **código de 8 dígitos**
e **só lê** as mensagens novas (não envia, não marca como lida, não fica online). Sessão salva em `data/whatsapp-sessao/`
(reiniciar não pede QR de novo; faça backup dessa pasta).

- Quem chama vira **Cliente + Negócio** no funil/estágio/responsável escolhidos, com a origem do anúncio
  Clique para WhatsApp (plataforma, título, id, link, ctwaClid). Opção "só quem veio de anúncio".
- Contato com negócio aberto que volta a chamar: fica no estágio, conta **retorno** e guarda a **fonte mais recente**.
- Cada entrada/retorno vira um registro de **Interação** (tipo WhatsApp) na linha do tempo.
- **Landing page de rastreio** `/lp/<token>` com código invisível na mensagem + **webhook** `POST /api/webhook/lp/<token>` (UTMs).
- Tempo real: lead novo aparece sozinho no funil, com aviso, som e notificação do navegador.
- **Simulador** na própria tela para testar sem celular.
- Campos novos nos Relatórios (Negócio): Entrada do lead, Plataforma do anúncio, Anúncio, UTM source/campaign, Retornos.
- Para abrir a landing page no celular (mesmo Wi-Fi): `HOST=0.0.0.0 npm start`.
- Sem SMTP aqui: os alertas de queda/desvinculação aparecem na tela e no log (Administração → Registros).

## Segurança

- **Papéis:** *Administrador* gerencia usuários, equipes, funis, opções, automações, configurações, WhatsApp e vê os registros (log). *Gestor* também edita metas e exclui painéis de relatório. *Usuário* trabalha com clientes, negócios, documentos, tarefas, interações e relatórios. As regras valem no servidor, não só na tela.
- **Senhas:** mínimo de 8 caracteres, sem senhas comuns. Quem entra com a senha de demonstração (`admin123`, `lente123`) ou uma senha fraca precisa criar outra antes de usar o sistema. Hash scrypt com salt de 16 bytes.
- **Login:** 5 senhas erradas para o mesmo e-mail (ou 30 do mesmo IP) bloqueiam por 15 minutos.
- **Sessões:** expiram após 12 h sem uso ou 7 dias. Suspender um usuário, trocar a senha ou o perfil dele encerra as sessões abertas.
- **Rede:** o servidor só atende pelos endereços conhecidos (proteção contra DNS rebinding) e recusa envios de outros sites (CSRF). Para usar com um domínio próprio, defina `CRM_HOSTS=meu.dominio.com`; atrás de HTTPS, defina `CRM_HTTPS=1` (cookie `Secure`).
- **Limites:** 600 requisições/min por sessão e 300/min por IP sem login (ajustáveis com `CRM_LIMITE_SESSAO` e `CRM_LIMITE_IP`).
- **Testes:** `npm test` roda 24 testes de segurança num servidor temporário (não toca em `data/`).
