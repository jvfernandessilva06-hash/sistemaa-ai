const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { abrirBanco } = require('./banco.cjs');
const root = __dirname;
const port = Number(process.env.PORT || 3000);
const databasePath = process.env.PRODUCTS_DB || path.join(root, 'data', 'produtos.db');
const db = abrirBanco(databasePath);
const TOTAL_COMANDAS = 50;
const HORAS_SESSAO = 12;
const METODOS = ['Dinheiro','Pix','Débito','Crédito','Crediário','Voucher'];

class ErroHttp extends Error { constructor(status, mensagem) { super(mensagem); this.status = status; } }
function falha(status, mensagem) { throw new ErroHttp(status, mensagem); }
function centavos(valor) { return Math.round((valor + Number.EPSILON) * 100); }
function reais(valor) { return (valor || 0) / 100; }
function texto(valor, max) { return typeof valor === 'string' ? valor.trim().slice(0, max) : ''; }
function transacao(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function hoje() { return db.prepare("SELECT date('now','localtime') AS d").get().d; }
function dataParam(valor) { return /^\d{4}-\d{2}-\d{2}$/.test(valor || '') ? valor : null; }

// ---------- PRODUTOS ----------
function produto(row) {
 return {id:row.id,codigo:row.codigo,nome:row.nome,preco:row.preco_centavos/100,unidade:row.unidade,categoria:row.categoria,codigoBarras:row.codigo_barras,requerCozinha:!!row.requer_cozinha,ativo:!!row.ativo};
}
function validarProduto(body) {
 const codigo = typeof body.codigo==='string' ? body.codigo.trim() : '';
 const nome = typeof body.nome==='string' ? body.nome.trim() : '';
 if (!codigo || codigo.length>40) falha(400,'Informe um código de até 40 caracteres.');
 if (!nome || nome.length>120) falha(400,'Informe um nome de até 120 caracteres.');
 if (typeof body.preco!=='number' || !Number.isFinite(body.preco) || body.preco<0 || body.preco>999999.99 || Math.abs(body.preco*100-Math.round(body.preco*100))>0.00001) falha(400,'Informe um preço válido com até duas casas decimais.');
 if (!['UN','KG'].includes(body.unidade)) falha(400,'Selecione unidade ou kg.');
 if (typeof body.requerCozinha!=='boolean' || typeof body.ativo!=='boolean') falha(400,'Informe o status e o envio à cozinha.');
 for (const campo of ['categoria','codigoBarras']) if (body[campo]!==undefined && (typeof body[campo]!=='string' || body[campo].length>80)) falha(400,'Categoria e código de barras devem ter até 80 caracteres.');
 return [codigo,nome,Math.round(body.preco*100),body.unidade,(body.categoria||'').trim(),(body.codigoBarras||'').trim(),Number(body.requerCozinha),Number(body.ativo)];
}
function salvarProduto(ctx) {
 const campos = validarProduto(ctx.body);
 try {
  let id;
  if (ctx.params[0]) {
   id = Number(ctx.params[0]);
   const result = db.prepare('UPDATE produtos SET codigo=?,nome=?,preco_centavos=?,unidade=?,categoria=?,codigo_barras=?,requer_cozinha=?,ativo=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?').run(...campos,id);
   if (!result.changes) falha(404,'Produto não encontrado.');
  } else {
   id = Number(db.prepare('INSERT INTO produtos (codigo,nome,preco_centavos,unidade,categoria,codigo_barras,requer_cozinha,ativo) VALUES (?,?,?,?,?,?,?,?)').run(...campos).lastInsertRowid);
   ctx.status = 201;
  }
  return produto(db.prepare('SELECT * FROM produtos WHERE id=?').get(id));
 } catch(e) {
  if (String(e.message).includes('UNIQUE')) falha(409,'Este código já está cadastrado. Use outro código.');
  throw e;
 }
}

// ---------- USUÁRIOS E LOGIN ----------
function hashSenha(senha) {
 const salt = crypto.randomBytes(16).toString('hex');
 return salt + ':' + crypto.scryptSync(senha, salt, 64).toString('hex');
}
function senhaConfere(senha, guardado) {
 const [salt, hash] = String(guardado).split(':');
 if (!salt || !hash) return false;
 const esperado = Buffer.from(hash, 'hex');
 return crypto.timingSafeEqual(crypto.scryptSync(String(senha), salt, esperado.length), esperado);
}
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
function usuarioPublico(u) { return {id:u.id,nome:u.nome,login:u.login,perfil:u.perfil,ativo:!!u.ativo,criadoEm:u.criado_em}; }
function totalUsuarios() { return db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n; }
function lerToken(req) { const m = /(?:^|;\s*)sessao=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || ''); return m ? m[1] : null; }
function usuarioDaSessao(req) {
 const token = lerToken(req);
 if (!token) return null;
 return db.prepare("SELECT u.* FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token_hash=? AND s.expira_em > datetime('now') AND u.ativo=1").get(hashToken(token)) || null;
}
function criarSessao(res, usuarioId) {
 const token = crypto.randomBytes(32).toString('hex');
 db.prepare("DELETE FROM sessoes WHERE expira_em <= datetime('now')").run();
 db.prepare(`INSERT INTO sessoes (token_hash,usuario_id,expira_em) VALUES (?,?,datetime('now','+${HORAS_SESSAO} hours'))`).run(hashToken(token), usuarioId);
 res.setHeader('Set-Cookie', `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${HORAS_SESSAO*3600}`);
}
function validarUsuario(body, novo) {
 const nome = texto(body.nome, 81);
 if (!nome || nome.length > 80) falha(400,'Informe o nome (até 80 caracteres).');
 if (!['admin','atendente'].includes(body.perfil)) falha(400,'Escolha o perfil: administrador ou atendente.');
 if (typeof body.ativo !== 'boolean') falha(400,'Informe se o usuário está ativo.');
 const senha = typeof body.senha === 'string' ? body.senha : '';
 if ((novo || senha) && (senha.length < 6 || senha.length > 100)) falha(400,'A senha deve ter de 6 a 100 caracteres.');
 const dados = {nome, perfil:body.perfil, ativo:body.ativo, senha};
 if (novo) {
  dados.login = texto(body.login, 41).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(dados.login)) falha(400,'O login deve ter de 3 a 40 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.');
 }
 return dados;
}
function inserirUsuario(dados) {
 try { return Number(db.prepare('INSERT INTO usuarios (nome,login,senha_hash,perfil,ativo) VALUES (?,?,?,?,?)').run(dados.nome, dados.login, hashSenha(dados.senha), dados.perfil, Number(dados.ativo)).lastInsertRowid); }
 catch(e) { if (String(e.message).includes('UNIQUE')) falha(409,'Este login já está em uso. Escolha outro.'); throw e; }
}
const tentativas = new Map();
function login(ctx) {
 const chave = texto(ctx.body.login, 41).toLowerCase();
 const t = tentativas.get(chave);
 if (t && t.bloqueadoAte > Date.now()) falha(429,'Muitas tentativas erradas. Aguarde 1 minuto e tente de novo.');
 const u = db.prepare('SELECT * FROM usuarios WHERE login=? AND ativo=1').get(chave);
 if (!u || !senhaConfere(typeof ctx.body.senha === 'string' ? ctx.body.senha : '', u.senha_hash)) {
  const falhas = (t?.falhas || 0) + 1;
  tentativas.set(chave, falhas >= 5 ? {falhas:0, bloqueadoAte:Date.now()+60000} : {falhas, bloqueadoAte:0});
  falha(401,'Login ou senha incorretos.');
 }
 tentativas.delete(chave);
 criarSessao(ctx.res, u.id);
 return {usuario:usuarioPublico(u)};
}
function configurar(ctx) {
 if (totalUsuarios() > 0) falha(409,'O administrador já foi criado. Faça login.');
 const dados = validarUsuario({...ctx.body, perfil:'admin', ativo:true}, true);
 const id = inserirUsuario(dados);
 criarSessao(ctx.res, id);
 ctx.status = 201;
 return {usuario:usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id=?').get(id))};
}
function salvarUsuario(ctx) {
 const novo = !ctx.params[0];
 const dados = validarUsuario(ctx.body, novo);
 if (novo) { ctx.status = 201; return usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id=?').get(inserirUsuario(dados))); }
 const id = Number(ctx.params[0]);
 const atual = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id);
 if (!atual) falha(404,'Usuário não encontrado.');
 const outrosAdmins = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE perfil='admin' AND ativo=1 AND id<>?").get(id).n;
 if (atual.perfil === 'admin' && atual.ativo && (dados.perfil !== 'admin' || !dados.ativo) && !outrosAdmins) falha(400,'O sistema precisa de pelo menos um administrador ativo.');
 transacao(() => {
  db.prepare('UPDATE usuarios SET nome=?,perfil=?,ativo=? WHERE id=?').run(dados.nome, dados.perfil, Number(dados.ativo), id);
  if (dados.senha) db.prepare('UPDATE usuarios SET senha_hash=? WHERE id=?').run(hashSenha(dados.senha), id);
  // Troca de senha, perfil ou desativação derruba as outras sessões desse usuário.
  if (dados.senha || !dados.ativo || dados.perfil !== atual.perfil) db.prepare('DELETE FROM sessoes WHERE usuario_id=? AND token_hash<>?').run(id, hashToken(lerToken(ctx.req) || ''));
 });
 return usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id=?').get(id));
}

// ---------- CAIXA ----------
function caixaAberto() {
 return db.prepare('SELECT c.*, u.nome AS operador FROM caixas c JOIN usuarios u ON u.id=c.aberto_por WHERE c.fechado_em IS NULL ORDER BY c.id DESC LIMIT 1').get() || null;
}
function resumoCaixa(c) {
 const vendas = db.prepare('SELECT COUNT(*) AS qtd, COALESCE(SUM(total_centavos),0) AS total FROM vendas WHERE caixa_id=? AND cancelada=0').get(c.id);
 const pagamentos = db.prepare('SELECT p.metodo, SUM(p.valor_centavos) AS valor FROM venda_pagamentos p JOIN vendas v ON v.id=p.venda_id WHERE v.caixa_id=? AND v.cancelada=0 GROUP BY p.metodo ORDER BY valor DESC').all(c.id);
 const esperado = c.fundo_centavos + (pagamentos.find(p => p.metodo === 'Dinheiro')?.valor || 0);
 const contado = c.contado_centavos;
 return {vendas:vendas.qtd, total:reais(vendas.total), pagamentos:pagamentos.map(p => ({metodo:p.metodo, valor:reais(p.valor)})), dinheiroEsperado:reais(esperado), contado:contado == null ? null : reais(contado), diferenca:contado == null ? null : reais(contado - esperado)};
}
function caixaPublico(c, admin) {
 if (!c) return null;
 const base = {id:c.id, abertoEm:c.aberto_em, operador:c.operador, fundo:reais(c.fundo_centavos), fechadoEm:c.fechado_em, fechadoPor:c.fechado_por_nome || null};
 return admin ? {...base, observacao:c.observacao, resumo:resumoCaixa(c)} : base;
}
function abrirCaixa(ctx) {
 const fundo = ctx.body.fundo;
 if (typeof fundo !== 'number' || !Number.isFinite(fundo) || fundo < 0 || fundo > 999999.99) falha(400,'Informe um fundo de caixa válido.');
 const id = transacao(() => {
  if (caixaAberto()) falha(409,'Já existe um caixa aberto.');
  return db.prepare('INSERT INTO caixas (aberto_por,fundo_centavos) VALUES (?,?)').run(ctx.usuario.id, centavos(fundo)).lastInsertRowid;
 });
 ctx.status = 201;
 return {caixa:caixaPublico(db.prepare('SELECT c.*, u.nome AS operador FROM caixas c JOIN usuarios u ON u.id=c.aberto_por WHERE c.id=?').get(id), ctx.usuario.perfil === 'admin')};
}
function fecharCaixa(ctx) {
 const contado = ctx.body.contado;
 if (typeof contado !== 'number' || !Number.isFinite(contado) || contado < 0 || contado > 999999.99) falha(400,'Informe o valor em dinheiro contado na gaveta.');
 const c = caixaAberto();
 if (!c) falha(409,'Não há caixa aberto.');
 db.prepare("UPDATE caixas SET fechado_em=datetime('now','localtime'), fechado_por=?, contado_centavos=?, observacao=? WHERE id=?").run(ctx.usuario.id, centavos(contado), texto(ctx.body.observacao, 200), c.id);
 // O atendente faz a contagem "às cegas": quem confere a diferença é o administrador.
 return {caixa:ctx.usuario.perfil === 'admin' ? caixaPublico(buscarCaixa(c.id), true) : null};
}
function buscarCaixa(id) {
 return db.prepare('SELECT c.*, a.nome AS operador, f.nome AS fechado_por_nome FROM caixas c JOIN usuarios a ON a.id=c.aberto_por LEFT JOIN usuarios f ON f.id=c.fechado_por WHERE c.id=?').get(id);
}

// ---------- COMANDAS ----------
function comandaVazia() { return {aberta:false, itens:[], adiantamento:0, desconto:0}; }
function totalItemCentavos(item) { return Math.round(centavos(item.preco) * Math.round(item.qtd * 1000) / 1000); }
function numeroComanda(valor) {
 const n = Number(valor);
 if (!Number.isInteger(n) || n < 1 || n > TOTAL_COMANDAS) falha(400,'Comanda inválida.');
 return n;
}
function lerComanda(numero) {
 const row = db.prepare('SELECT dados FROM comandas WHERE numero=?').get(numero);
 return row ? JSON.parse(row.dados) : comandaVazia();
}
function lerComandas() {
 const todas = {};
 for (let n = 1; n <= TOTAL_COMANDAS; n++) todas[n] = comandaVazia();
 for (const row of db.prepare('SELECT numero, dados FROM comandas').all()) todas[row.numero] = JSON.parse(row.dados);
 return todas;
}
function quantidadeValida(qtd, unidade) {
 return typeof qtd === 'number' && Number.isFinite(qtd) && qtd > 0 && qtd <= 999999 && (unidade === 'KG' ? Math.abs(qtd * 1000 - Math.round(qtd * 1000)) < 0.000001 : Number.isInteger(qtd));
}
function validarComanda(c) {
 if (!c || typeof c !== 'object' || !Array.isArray(c.itens) || c.itens.length > 200) falha(400,'Dados da comanda inválidos.');
 const itens = c.itens.map(i => {
  if (!i || typeof i !== 'object') falha(400,'Item inválido na comanda.');
  const unidade = i.unidade === 'KG' ? 'KG' : 'UN';
  const nome = texto(i.nome, 120);
  if (!nome) falha(400,'Item sem nome na comanda.');
  if (typeof i.preco !== 'number' || !Number.isFinite(i.preco) || i.preco < 0 || i.preco > 999999.99) falha(400,`Preço inválido em ${nome}.`);
  if (!quantidadeValida(i.qtd, unidade)) falha(400,`Quantidade inválida em ${nome}.`);
  return {id:Number.isInteger(i.id) ? i.id : null, codigo:texto(i.codigo, 40), nome, preco:i.preco, unidade, categoria:texto(i.categoria, 80), codigoBarras:texto(i.codigoBarras, 80), requerCozinha:i.requerCozinha === true, ativo:true, qtd:i.qtd, obs:texto(i.obs, 200), impresso:i.impresso === true};
 });
 const adiantamento = Number(c.adiantamento || 0), desconto = Number(c.desconto || 0);
 if (![adiantamento, desconto].every(v => Number.isFinite(v) && v >= 0)) falha(400,'Valores da comanda inválidos.');
 const subtotal = itens.reduce((s, i) => s + totalItemCentavos(i), 0);
 if (centavos(adiantamento) + centavos(desconto) > subtotal) falha(400,'O desconto e o adiantamento não podem passar do valor dos itens.');
 return {aberta:c.aberta === true || itens.length > 0, itens, adiantamento, desconto};
}
function salvarComandas(ctx) {
 const recebidas = ctx.body.comandas;
 if (!recebidas || typeof recebidas !== 'object' || Array.isArray(recebidas)) falha(400,'Dados das comandas inválidos.');
 const validas = Object.entries(recebidas).map(([n, c]) => [numeroComanda(n), validarComanda(c)]);
 transacao(() => {
  for (const [n, c] of validas) {
   if (!c.aberta) db.prepare('DELETE FROM comandas WHERE numero=?').run(n);
   else db.prepare("INSERT INTO comandas (numero,dados) VALUES (?,?) ON CONFLICT(numero) DO UPDATE SET dados=excluded.dados, atualizado_em=datetime('now','localtime')").run(n, JSON.stringify(c));
  }
 });
 return {ok:true};
}

// ---------- VENDAS ----------
function registrarVenda(ctx) {
 const {usuario, body} = ctx;
 const numero = numeroComanda(body.comanda);
 const desconto = body.desconto ?? 0;
 if (!Number.isInteger(desconto) || desconto < 0) falha(400,'Desconto inválido.');
 if (!Array.isArray(body.pagamentos) || body.pagamentos.length > METODOS.length) falha(400,'Formas de pagamento inválidas.');
 const pagamentos = body.pagamentos.map(p => {
  if (!p || !METODOS.includes(p.metodo) || !Number.isInteger(p.valor) || p.valor <= 0) falha(400,'Formas de pagamento inválidas.');
  return {metodo:p.metodo, valor:p.valor};
 });
 if (new Set(pagamentos.map(p => p.metodo)).size !== pagamentos.length) falha(400,'Cada forma de pagamento deve aparecer uma vez.');
 const cliente = texto(body.cliente, 120);
 const id = transacao(() => {
  const caixa = caixaAberto();
  if (!caixa) falha(409,'Abra o caixa antes de receber pagamentos.');
  const c = lerComanda(numero);
  if (!c.itens.length) falha(400,'A comanda não tem itens.');
  const subtotal = c.itens.reduce((s, i) => s + totalItemCentavos(i), 0);
  const adiantamento = centavos(c.adiantamento || 0);
  if (desconto + adiantamento > subtotal) falha(400,'O desconto deve estar entre zero e o saldo disponível.');
  const aPagar = subtotal - adiantamento - desconto;
  const informado = pagamentos.reduce((s, p) => s + p.valor, 0);
  const dinheiro = pagamentos.find(p => p.metodo === 'Dinheiro')?.valor || 0;
  const crediario = pagamentos.find(p => p.metodo === 'Crediário')?.valor || 0;
  if (informado < aPagar) falha(400,'Valor insuficiente. Complete o saldo nas formas de pagamento.');
  const troco = informado - aPagar;
  if (troco > dinheiro) falha(400,'Os valores das outras formas excedem o total. O troco só pode sair do dinheiro.');
  if (crediario && !cliente) falha(400,'Informe o cliente do crediário.');
  const status = crediario ? (crediario === aPagar ? 'A receber' : 'Parcial a receber') : 'Pago';
  // total_centavos é o faturamento da venda (itens menos desconto); o adiantamento é só uma forma de pagamento.
  const vendaId = Number(db.prepare('INSERT INTO vendas (caixa_id,usuario_id,comanda,subtotal_centavos,desconto_centavos,adiantamento_centavos,total_centavos,recebido_centavos,troco_centavos,cliente,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
   .run(caixa.id, usuario.id, numero, subtotal, desconto, adiantamento, subtotal - desconto, informado, troco, crediario ? cliente : '', status).lastInsertRowid);
  const inserirItem = db.prepare('INSERT INTO venda_itens (venda_id,produto_id,codigo,nome,categoria,unidade,quantidade,preco_centavos,total_centavos,observacao) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const i of c.itens) inserirItem.run(vendaId, i.id, i.codigo || '', i.nome, i.categoria || '', i.unidade || 'UN', i.qtd, centavos(i.preco), totalItemCentavos(i), i.obs || '');
  const inserirPagamento = db.prepare('INSERT INTO venda_pagamentos (venda_id,metodo,valor_centavos) VALUES (?,?,?)');
  if (adiantamento) inserirPagamento.run(vendaId, 'Adiantamento', adiantamento);
  for (const p of pagamentos) {
   const valor = p.metodo === 'Dinheiro' ? p.valor - troco : p.valor;
   if (valor > 0) inserirPagamento.run(vendaId, p.metodo, valor);
  }
  db.prepare('DELETE FROM comandas WHERE numero=?').run(numero);
  return vendaId;
 });
 ctx.status = 201;
 return vendaPublica(db.prepare('SELECT v.*, u.nome AS atendente FROM vendas v JOIN usuarios u ON u.id=v.usuario_id WHERE v.id=?').get(id));
}
function vendaPublica(v) {
 return {
  id:v.id, comanda:v.comanda, dataHora:v.data_hora, atendente:v.atendente, subtotal:reais(v.subtotal_centavos), desconto:reais(v.desconto_centavos),
  adiantamento:reais(v.adiantamento_centavos), valor:reais(v.total_centavos), recebido:reais(v.recebido_centavos), troco:reais(v.troco_centavos),
  cliente:v.cliente, status:v.status, cancelada:!!v.cancelada, motivoCancelamento:v.motivo_cancelamento,
  pagamentos:db.prepare('SELECT metodo, valor_centavos FROM venda_pagamentos WHERE venda_id=? ORDER BY id').all(v.id).map(p => ({metodo:p.metodo, valor:reais(p.valor_centavos)})),
  itens:db.prepare('SELECT * FROM venda_itens WHERE venda_id=? ORDER BY id').all(v.id).map(i => ({nome:i.nome, qtd:i.quantidade, unidade:i.unidade, preco:reais(i.preco_centavos), total:reais(i.total_centavos), obs:i.observacao}))
 };
}
function listarVendas(ctx) {
 let filtro, params;
 if (ctx.usuario.perfil === 'admin') {
  const inicio = dataParam(ctx.url.searchParams.get('inicio')) || hoje();
  const fim = dataParam(ctx.url.searchParams.get('fim')) || inicio;
  filtro = 'date(v.data_hora) BETWEEN ? AND ?'; params = [inicio, fim];
 } else {
  // Atendente vê apenas as vendas do caixa aberto agora.
  const caixa = caixaAberto();
  if (!caixa) return [];
  filtro = 'v.caixa_id=?'; params = [caixa.id];
 }
 return db.prepare(`SELECT v.*, u.nome AS atendente FROM vendas v JOIN usuarios u ON u.id=v.usuario_id WHERE ${filtro} ORDER BY v.id DESC LIMIT 1000`).all(...params).map(vendaPublica);
}
function cancelarVenda(ctx) {
 const motivo = texto(ctx.body.motivo, 200);
 if (!motivo) falha(400,'Informe o motivo do cancelamento.');
 const r = db.prepare("UPDATE vendas SET cancelada=1, cancelada_em=datetime('now','localtime'), cancelada_por=?, motivo_cancelamento=? WHERE id=? AND cancelada=0").run(ctx.usuario.id, motivo, Number(ctx.params[0]));
 if (!r.changes) falha(404,'Venda não encontrada ou já cancelada.');
 return {ok:true};
}

// ---------- RELATÓRIOS ----------
function relatorio(ctx) {
 const inicio = dataParam(ctx.url.searchParams.get('inicio')) || db.prepare("SELECT date('now','localtime','start of month') AS d").get().d;
 const fim = dataParam(ctx.url.searchParams.get('fim')) || hoje();
 if (inicio > fim) falha(400,'A data inicial deve ser anterior à final.');
 const p = [inicio, fim];
 const filtro = 'v.cancelada=0 AND date(v.data_hora) BETWEEN ? AND ?';
 // A categoria atual do produto tem prioridade, para que recategorizar um produto reorganize o histórico.
 const categoria = "COALESCE(NULLIF(pr.categoria,''), NULLIF(vi.categoria,''), 'Sem categoria')";
 const resumo = db.prepare(`SELECT COUNT(*) AS vendas, COALESCE(SUM(total_centavos),0) AS faturamento, COALESCE(SUM(desconto_centavos),0) AS descontos FROM vendas v WHERE ${filtro}`).get(...p);
 const canceladas = db.prepare('SELECT COUNT(*) AS vendas, COALESCE(SUM(total_centavos),0) AS valor FROM vendas v WHERE v.cancelada=1 AND date(v.data_hora) BETWEEN ? AND ?').get(...p);
 const valores = rows => rows.map(r => ({...r, valor:reais(r.valor)}));
 return {
  inicio, fim,
  resumo:{vendas:resumo.vendas, faturamento:reais(resumo.faturamento), ticketMedio:resumo.vendas ? reais(Math.round(resumo.faturamento / resumo.vendas)) : 0, descontos:reais(resumo.descontos), canceladas:canceladas.vendas, valorCancelado:reais(canceladas.valor)},
  produtos:valores(db.prepare(`SELECT COALESCE(pr.nome, vi.nome) AS nome, vi.codigo, ${categoria} AS categoria, vi.unidade, ROUND(SUM(vi.quantidade),3) AS quantidade, SUM(vi.total_centavos) AS valor, COUNT(DISTINCT vi.venda_id) AS vendas FROM venda_itens vi JOIN vendas v ON v.id=vi.venda_id LEFT JOIN produtos pr ON pr.id=vi.produto_id WHERE ${filtro} GROUP BY COALESCE(vi.produto_id, vi.codigo || '|' || vi.nome) ORDER BY valor DESC`).all(...p)),
  categorias:valores(db.prepare(`SELECT ${categoria} AS categoria, SUM(vi.total_centavos) AS valor, COUNT(*) AS itens, COUNT(DISTINCT vi.venda_id) AS vendas FROM venda_itens vi JOIN vendas v ON v.id=vi.venda_id LEFT JOIN produtos pr ON pr.id=vi.produto_id WHERE ${filtro} GROUP BY 1 ORDER BY valor DESC`).all(...p)),
  pagamentos:valores(db.prepare(`SELECT pg.metodo, SUM(pg.valor_centavos) AS valor, COUNT(DISTINCT pg.venda_id) AS vendas FROM venda_pagamentos pg JOIN vendas v ON v.id=pg.venda_id WHERE ${filtro} GROUP BY pg.metodo ORDER BY valor DESC`).all(...p)),
  dias:valores(db.prepare(`SELECT date(v.data_hora) AS dia, COUNT(*) AS vendas, SUM(v.total_centavos) AS valor FROM vendas v WHERE ${filtro} GROUP BY dia ORDER BY dia`).all(...p)),
  horas:valores(db.prepare(`SELECT CAST(strftime('%H', v.data_hora) AS INTEGER) AS hora, COUNT(*) AS vendas, SUM(v.total_centavos) AS valor FROM vendas v WHERE ${filtro} GROUP BY hora ORDER BY hora`).all(...p)),
  atendentes:valores(db.prepare(`SELECT u.nome, COUNT(*) AS vendas, SUM(v.total_centavos) AS valor FROM vendas v JOIN usuarios u ON u.id=v.usuario_id WHERE ${filtro} GROUP BY u.id ORDER BY valor DESC`).all(...p))
 };
}

// ---------- ROTAS ----------
// [método, endereço, quem pode acessar, ação]
const rotas = [
 ['GET', /^\/api\/me$/, 'publico', ctx => { const u = usuarioDaSessao(ctx.req); return {configurar:totalUsuarios() === 0, usuario:u ? usuarioPublico(u) : null}; }],
 ['POST', /^\/api\/setup$/, 'publico', configurar],
 ['POST', /^\/api\/login$/, 'publico', login],
 ['POST', /^\/api\/logout$/, 'logado', ctx => { db.prepare('DELETE FROM sessoes WHERE token_hash=?').run(hashToken(lerToken(ctx.req))); ctx.res.setHeader('Set-Cookie','sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return {ok:true}; }],
 ['GET', /^\/api\/produtos$/, 'logado', () => db.prepare('SELECT * FROM produtos ORDER BY nome COLLATE NOCASE').all().map(produto)],
 ['POST', /^\/api\/produtos$/, 'admin', salvarProduto],
 ['PUT', /^\/api\/produtos\/(\d+)$/, 'admin', salvarProduto],
 ['GET', /^\/api\/usuarios$/, 'admin', () => db.prepare('SELECT * FROM usuarios ORDER BY ativo DESC, nome COLLATE NOCASE').all().map(usuarioPublico)],
 ['POST', /^\/api\/usuarios$/, 'admin', salvarUsuario],
 ['PUT', /^\/api\/usuarios\/(\d+)$/, 'admin', salvarUsuario],
 ['GET', /^\/api\/caixa$/, 'logado', ctx => ({caixa:caixaPublico(caixaAberto(), ctx.usuario.perfil === 'admin')})],
 ['POST', /^\/api\/caixa\/abrir$/, 'logado', abrirCaixa],
 ['POST', /^\/api\/caixa\/fechar$/, 'logado', fecharCaixa],
 ['GET', /^\/api\/caixas$/, 'admin', () => db.prepare('SELECT id FROM caixas ORDER BY id DESC LIMIT 60').all().map(c => caixaPublico(buscarCaixa(c.id), true))],
 ['GET', /^\/api\/comandas$/, 'logado', lerComandas],
 ['PUT', /^\/api\/comandas$/, 'logado', salvarComandas],
 ['GET', /^\/api\/vendas$/, 'logado', listarVendas],
 ['POST', /^\/api\/vendas$/, 'logado', registrarVenda],
 ['POST', /^\/api\/vendas\/(\d+)\/cancelar$/, 'admin', cancelarVenda],
 ['GET', /^\/api\/relatorios$/, 'admin', relatorio]
];

function json(res,status,body) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); }
async function lerBody(req) {
 let texto='';
 for await (const chunk of req) { texto+=chunk; if (Buffer.byteLength(texto)>262144) falha(413,'Dados muito grandes.'); }
 try { const body=JSON.parse(texto); if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error(); return body; }
 catch { falha(400,'Dados inválidos.'); }
}
async function responderApi(req, res, url) {
 for (const [metodo, padrao, acesso, acao] of rotas) {
  const match = url.pathname.match(padrao);
  if (!match || req.method !== metodo) continue;
  try {
   let body = {};
   if (req.method !== 'GET') {
    if (req.headers.origin && ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)) falha(403,'Origem não permitida.');
    if (!req.headers['content-type']?.startsWith('application/json')) falha(415,'Envie os dados em JSON.');
    body = await lerBody(req);
   }
   const usuario = acesso === 'publico' ? null : usuarioDaSessao(req);
   if (acesso !== 'publico' && !usuario) falha(401,'Faça login para continuar.');
   if (acesso === 'admin' && usuario.perfil !== 'admin') falha(403,'Apenas o administrador pode fazer isso.');
   const ctx = {req, res, url, usuario, body, params:match.slice(1), status:200};
   const resposta = await acao(ctx);
   return json(res, ctx.status, resposta);
  } catch(e) {
   if (e instanceof ErroHttp) return json(res, e.status, {erro:e.message});
   throw e;
  }
 }
 json(res,404,{erro:'Endereço não encontrado.'});
}

const arquivos = {'/':'index.html','/index.html':'index.html','/script.js':'script.js','/style.css':'style.css'};
const tipos={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try {
  if (![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host)) return json(res,403,{erro:'Acesso permitido apenas neste computador.'});
  const url=new URL(req.url,`http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) return await responderApi(req, res, url);
  if (req.method==='GET' && arquivos[url.pathname]) {
   const filename=arquivos[url.pathname];
   res.writeHead(200,{'Content-Type':tipos[path.extname(filename)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
   return res.end(fs.readFileSync(path.join(root,filename)));
  }
  json(res,404,{erro:'Endereço não encontrado.'});
 } catch(e) { console.error(e); if (!res.headersSent) json(res,500,{erro:'Erro interno do sistema. Tente novamente.'}); else res.end(); }
});
server.listen(port,'127.0.0.1',()=>console.log(`Sistema disponível em http://localhost:${port}\nBanco de dados: ${databasePath}`));
server.on('error',e=>{ console.error(e.code==='EADDRINUSE'?'A porta já está em uso. Feche a outra execução do sistema ou use outra porta.':e.message); db.close(); process.exitCode=1; });
function encerrar(){ server.close(()=>{ db.close(); process.exit(); }); }
process.on('SIGINT',encerrar); process.on('SIGTERM',encerrar);
