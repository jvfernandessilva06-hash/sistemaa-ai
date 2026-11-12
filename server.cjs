const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const { execFile } = require('node:child_process');
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
 return {id:row.id,codigo:row.codigo,nome:row.nome,preco:row.preco_centavos/100,unidade:row.unidade,categoria:row.categoria,codigoBarras:row.codigo_barras,requerCozinha:!!row.requer_cozinha,ativo:!!row.ativo,adicional:!!row.adicional,aceitaAdicionais:!!row.aceita_adicionais};
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
 // adicional: vai junto de outro item (ex.: Nutella no açaí). aceitaAdicionais: abre a escolha de adicionais ao lançar.
 return [codigo,nome,Math.round(body.preco*100),body.unidade,(body.categoria||'').trim(),(body.codigoBarras||'').trim(),Number(body.requerCozinha),Number(body.ativo),Number(body.adicional === true),Number(body.aceitaAdicionais === true)];
}
function salvarProduto(ctx) {
 const campos = validarProduto(ctx.body);
 try {
  let id;
  if (ctx.params[0]) {
   id = Number(ctx.params[0]);
   const result = db.prepare('UPDATE produtos SET codigo=?,nome=?,preco_centavos=?,unidade=?,categoria=?,codigo_barras=?,requer_cozinha=?,ativo=?,adicional=?,aceita_adicionais=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?').run(...campos,id);
   if (!result.changes) falha(404,'Produto não encontrado.');
  } else {
   id = Number(db.prepare('INSERT INTO produtos (codigo,nome,preco_centavos,unidade,categoria,codigo_barras,requer_cozinha,ativo,adicional,aceita_adicionais) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...campos).lastInsertRowid);
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
 const recebimentos = db.prepare('SELECT metodo, SUM(valor_centavos) AS valor FROM crediario_pagamentos WHERE caixa_id=? GROUP BY metodo ORDER BY valor DESC').all(c.id);
 const mov = db.prepare("SELECT COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor_centavos END),0) AS sangrias, COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor_centavos END),0) AS suprimentos FROM movimentos_caixa WHERE caixa_id=?").get(c.id);
 // Dinheiro na gaveta = fundo + vendas em dinheiro + crediário recebido em dinheiro + reforços - retiradas.
 const emDinheiro = lista => lista.find(p => p.metodo === 'Dinheiro')?.valor || 0;
 const esperado = c.fundo_centavos + emDinheiro(pagamentos) + emDinheiro(recebimentos) + mov.suprimentos - mov.sangrias;
 const contado = c.contado_centavos;
 return {vendas:vendas.qtd, total:reais(vendas.total), pagamentos:pagamentos.map(p => ({metodo:p.metodo, valor:reais(p.valor)})),
  recebimentosCrediario:recebimentos.map(p => ({metodo:p.metodo, valor:reais(p.valor)})), sangrias:reais(mov.sangrias), suprimentos:reais(mov.suprimentos),
  dinheiroEsperado:reais(esperado), contado:contado == null ? null : reais(contado), diferenca:contado == null ? null : reais(contado - esperado)};
}
function movimentosCaixa(caixaId) {
 return db.prepare('SELECT m.*, u.nome AS usuario FROM movimentos_caixa m JOIN usuarios u ON u.id=m.usuario_id WHERE m.caixa_id=? ORDER BY m.id').all(caixaId)
  .map(m => ({id:m.id, tipo:m.tipo, valor:reais(m.valor_centavos), motivo:m.motivo, dataHora:m.data_hora, usuario:m.usuario}));
}
function caixaPublico(c, admin) {
 if (!c) return null;
 const base = {id:c.id, abertoEm:c.aberto_em, operador:c.operador, fundo:reais(c.fundo_centavos), fechadoEm:c.fechado_em, fechadoPor:c.fechado_por_nome || null, movimentos:movimentosCaixa(c.id)};
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
 try { fazerBackup(); } catch(e) { console.error('Backup no fechamento falhou:', e.message); }
 // O atendente faz a contagem "às cegas": quem confere a diferença é o administrador.
 return {caixa:ctx.usuario.perfil === 'admin' ? caixaPublico(buscarCaixa(c.id), true) : null};
}
// Sangria: dinheiro que sai da gaveta (ex.: pagar fornecedor). Suprimento: dinheiro que entra (ex.: reforço de troco).
function movimentarCaixa(ctx) {
 const {tipo, valor} = ctx.body;
 if (!['sangria','suprimento'].includes(tipo)) falha(400,'Escolha retirada (sangria) ou reforço (suprimento).');
 if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > 999999.99) falha(400,'Informe um valor maior que zero.');
 const motivo = texto(ctx.body.motivo, 200);
 if (tipo === 'sangria' && !motivo) falha(400,'Informe o motivo da retirada.');
 const c = caixaAberto();
 if (!c) falha(409,'Abra o caixa antes de registrar retiradas ou reforços.');
 db.prepare('INSERT INTO movimentos_caixa (caixa_id,usuario_id,tipo,valor_centavos,motivo) VALUES (?,?,?,?,?)').run(c.id, ctx.usuario.id, tipo, centavos(valor), motivo);
 ctx.status = 201;
 return {caixa:caixaPublico(caixaAberto(), ctx.usuario.perfil === 'admin')};
}
function buscarCaixa(id) {
 return db.prepare('SELECT c.*, a.nome AS operador, f.nome AS fechado_por_nome FROM caixas c JOIN usuarios a ON a.id=c.aberto_por LEFT JOIN usuarios f ON f.id=c.fechado_por WHERE c.id=?').get(id);
}

// ---------- COMANDAS ----------
function comandaVazia() { return {aberta:false, itens:[], adiantamento:0, desconto:0}; }
// Adicionais são por unidade: 2 açaís com Nutella = 2 Nutellas. No item por kg, o adicional vai uma vez só.
function baseItemCentavos(item) { return Math.round(centavos(item.preco) * Math.round(item.qtd * 1000) / 1000); }
function multiplicadorAdicionais(item) { return item.unidade === 'KG' ? 1 : item.qtd; }
function totalItemCentavos(item) {
 return baseItemCentavos(item) + (item.adicionais || []).reduce((s, a) => s + centavos(a.preco) * a.qtd, 0) * multiplicadorAdicionais(item);
}
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
  if (i.adicionais !== undefined && (!Array.isArray(i.adicionais) || i.adicionais.length > 20)) falha(400,`Adicionais inválidos em ${nome}.`);
  const adicionais = (i.adicionais || []).map(a => {
   const nomeAdicional = texto(a?.nome, 120);
   if (!nomeAdicional || typeof a.preco !== 'number' || !Number.isFinite(a.preco) || a.preco < 0 || a.preco > 9999.99 || !Number.isInteger(a.qtd) || a.qtd < 1 || a.qtd > 20) falha(400,`Adicional inválido em ${nome}.`);
   return {id:Number.isInteger(a.id) ? a.id : null, codigo:texto(a.codigo, 40), nome:nomeAdicional, categoria:texto(a.categoria, 80), preco:a.preco, qtd:a.qtd};
  });
  return {uid:typeof i.uid === 'string' && /^[a-z0-9]{6,24}$/.test(i.uid) ? i.uid : null, id:Number.isInteger(i.id) ? i.id : null, codigo:texto(i.codigo, 40), nome, preco:i.preco, unidade, categoria:texto(i.categoria, 80), codigoBarras:texto(i.codigoBarras, 80), requerCozinha:i.requerCozinha === true, aceitaAdicionais:i.aceitaAdicionais === true, ativo:true, qtd:i.qtd, obs:texto(i.obs, 200), impresso:i.impresso === true, adicionais};
 });
 const adiantamento = Number(c.adiantamento || 0), desconto = Number(c.desconto || 0);
 if (![adiantamento, desconto].every(v => Number.isFinite(v) && v >= 0)) falha(400,'Valores da comanda inválidos.');
 const subtotal = itens.reduce((s, i) => s + totalItemCentavos(i), 0);
 if (centavos(adiantamento) + centavos(desconto) > subtotal) falha(400,'O desconto e o adiantamento não podem passar do valor dos itens.');
 // Número da comanda que vibra, só quando é diferente do número da comanda (sai no pedido da cozinha).
 const vibra = c.vibra === undefined || c.vibra === null ? null : Number(c.vibra);
 if (vibra !== null && (!Number.isInteger(vibra) || vibra < 1 || vibra > 999)) falha(400,'O número da comanda que vibra deve ser de 1 a 999.');
 return {aberta:c.aberta === true || itens.length > 0, itens, adiantamento, desconto, ...(vibra ? {vibra} : {})};
}
function salvarComandas(ctx) {
 const recebidas = ctx.body.comandas;
 if (!recebidas || typeof recebidas !== 'object' || Array.isArray(recebidas)) falha(400,'Dados das comandas inválidos.');
 const validas = Object.entries(recebidas).map(([n, c]) => [numeroComanda(n), validarComanda(c)]);
 const t = ctx.body.transferencia;
 const transferencia = t && Number.isInteger(t.origem) && Number.isInteger(t.destino) ? {origem:t.origem, destino:t.destino} : null;
 transacao(() => {
  for (const [n, c] of validas) {
   registrarRetiradas(ctx.usuario, n, lerComanda(n), c, transferencia);
   if (!c.aberta) db.prepare('DELETE FROM comandas WHERE numero=?').run(n);
   else db.prepare("INSERT INTO comandas (numero,dados) VALUES (?,?) ON CONFLICT(numero) DO UPDATE SET dados=excluded.dados, atualizado_em=datetime('now','localtime')").run(n, JSON.stringify(c));
  }
 });
 return {ok:true};
}
// Guarda quem tirou itens de uma comanda (ou transferiu), para o administrador consultar. Não bloqueia nada.
function registrarRetiradas(usuario, numero, antiga, nova, transferencia) {
 const atuais = new Map(nova.itens.filter(i => i.uid).map(i => [i.uid, i]));
 for (const item of antiga.itens) {
  if (!item.uid) continue;
  const restante = atuais.get(item.uid)?.qtd || 0;
  const retirado = Math.round((item.qtd - restante) * 1000) / 1000;
  if (retirado <= 0) continue;
  const transferiu = transferencia?.origem === numero;
  const quantidade = item.unidade === 'KG' ? `${retirado.toLocaleString('pt-BR', {minimumFractionDigits:3})} kg` : `${retirado}x`;
  db.prepare('INSERT INTO registro_comandas (usuario_id,comanda,acao,descricao,enviado_cozinha) VALUES (?,?,?,?,?)')
   .run(usuario.id, numero, transferiu ? 'transferiu' : 'removeu', `${quantidade} ${item.nome}${transferiu ? ` para a comanda ${transferencia.destino}` : ''}`, Number(item.impresso === true));
 }
}
function listarRegistro(ctx) {
 const inicio = dataParam(ctx.url.searchParams.get('inicio')) || hoje();
 const fim = dataParam(ctx.url.searchParams.get('fim')) || inicio;
 return db.prepare('SELECT r.*, u.nome AS usuario FROM registro_comandas r JOIN usuarios u ON u.id=r.usuario_id WHERE date(r.data_hora) BETWEEN ? AND ? ORDER BY r.id DESC LIMIT 1000').all(inicio, fim)
  .map(r => ({dataHora:r.data_hora, usuario:r.usuario, comanda:r.comanda, acao:r.acao, descricao:r.descricao, enviadoCozinha:!!r.enviado_cozinha}));
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
  // Crediário só para contas cadastradas (funcionários com CPF ou a empresa com CNPJ).
  const conta = crediario ? db.prepare('SELECT * FROM contas_crediario WHERE id=? AND ativo=1').get(Number(body.contaCrediario) || 0) : null;
  if (crediario && !conta) falha(400,'Escolha o funcionário ou a empresa do crediário.');
  const cliente = conta ? conta.nome : '';
  const status = crediario ? (crediario === aPagar ? 'A receber' : 'Parcial a receber') : 'Pago';
  // total_centavos é o faturamento da venda (itens menos desconto); o adiantamento é só uma forma de pagamento.
  const vendaId = Number(db.prepare('INSERT INTO vendas (caixa_id,usuario_id,comanda,subtotal_centavos,desconto_centavos,adiantamento_centavos,total_centavos,recebido_centavos,troco_centavos,cliente,status,conta_crediario_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(caixa.id, usuario.id, numero, subtotal, desconto, adiantamento, subtotal - desconto, informado, troco, cliente, status, conta?.id ?? null).lastInsertRowid);
  const inserirItem = db.prepare('INSERT INTO venda_itens (venda_id,produto_id,codigo,nome,categoria,unidade,quantidade,preco_centavos,total_centavos,observacao,adicional_de) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const i of c.itens) {
   const paiId = Number(inserirItem.run(vendaId, i.id, i.codigo || '', i.nome, i.categoria || '', i.unidade || 'UN', i.qtd, centavos(i.preco), baseItemCentavos(i), i.obs || '', null).lastInsertRowid);
   // Cada adicional vira uma linha própria, ligada ao item: assim o relatório conta quantas Nutellas saíram.
   const vezes = multiplicadorAdicionais(i);
   for (const a of i.adicionais || []) inserirItem.run(vendaId, a.id, a.codigo || '', a.nome, a.categoria || '', 'UN', a.qtd * vezes, centavos(a.preco), centavos(a.preco) * a.qtd * vezes, '', paiId);
  }
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
  itens:itensDaVenda(v.id)
 };
}
function itensDaVenda(vendaId) {
 const linhas = db.prepare('SELECT * FROM venda_itens WHERE venda_id=? ORDER BY id').all(vendaId);
 const itens = new Map();
 for (const i of linhas.filter(l => !l.adicional_de)) itens.set(i.id, {nome:i.nome, qtd:i.quantidade, unidade:i.unidade, preco:reais(i.preco_centavos), total:reais(i.total_centavos), obs:i.observacao, adicionais:[]});
 for (const a of linhas.filter(l => l.adicional_de)) itens.get(a.adicional_de)?.adicionais.push({nome:a.nome, qtd:a.quantidade, preco:reais(a.preco_centavos), total:reais(a.total_centavos)});
 return [...itens.values()];
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

// ---------- CREDIÁRIO ----------
// Só funcionários (CPF) e a própria empresa (CNPJ) compram no crediário, e precisam estar cadastrados antes.
function soDigitos(valor) { return String(valor || '').replace(/\D/g, ''); }
function cpfValido(cpf) {
 if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
 const digito = n => { const soma = [...cpf.slice(0, n)].reduce((s, d, i) => s + Number(d) * (n + 1 - i), 0); return (soma * 10 % 11) % 10; };
 return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}
function cnpjValido(cnpj) {
 if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
 const digito = n => { const pesos = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const resto = [...cnpj.slice(0, n)].reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11; return resto < 2 ? 0 : 11 - resto; };
 return digito(12) === Number(cnpj[12]) && digito(13) === Number(cnpj[13]);
}
function contaPublica(c) { return {id:c.id, nome:c.nome, tipo:c.tipo, documento:c.documento, ativo:!!c.ativo}; }
function listarContas() { return db.prepare("SELECT * FROM contas_crediario ORDER BY ativo DESC, tipo='empresa' DESC, nome COLLATE NOCASE").all().map(contaPublica); }
function salvarConta(ctx) {
 const b = ctx.body;
 const nome = texto(b.nome, 121);
 if (!nome || nome.length > 120) falha(400,'Informe o nome.');
 if (!['funcionario','empresa'].includes(b.tipo)) falha(400,'Escolha se é funcionário ou empresa.');
 const documento = soDigitos(b.documento);
 if (b.tipo === 'funcionario' && !cpfValido(documento)) falha(400,'CPF inválido. Confira os números.');
 if (b.tipo === 'empresa' && !cnpjValido(documento)) falha(400,'CNPJ inválido. Confira os números.');
 const ativo = b.ativo !== false;
 try {
  if (ctx.params[0]) {
   if (!db.prepare('UPDATE contas_crediario SET nome=?, tipo=?, documento=?, ativo=? WHERE id=?').run(nome, b.tipo, documento, Number(ativo), Number(ctx.params[0])).changes) falha(404,'Cadastro não encontrado.');
  } else {
   db.prepare('INSERT INTO contas_crediario (nome,tipo,documento,ativo) VALUES (?,?,?,?)').run(nome, b.tipo, documento, Number(ativo));
   ctx.status = 201;
  }
 } catch(e) {
  if (String(e.message).includes('UNIQUE')) falha(409,'Este CPF/CNPJ já está cadastrado.');
  throw e;
 }
 return listarContas();
}

// O que cada conta ainda deve: parte da venda paga no crediário menos o que já foi recebido depois.
// Vendas antigas, de antes do cadastro de contas, continuam agrupadas pelo nome digitado.
const chaveCliente = nome => nome.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
function vendasEmAberto() {
 return db.prepare(`SELECT v.id, v.cliente, v.data_hora, v.comanda, v.conta_crediario_id, c.nome AS conta_nome, c.tipo AS conta_tipo, c.documento AS conta_documento,
  (SELECT COALESCE(SUM(valor_centavos),0) FROM venda_pagamentos WHERE venda_id=v.id AND metodo='Crediário') AS credito,
  (SELECT COALESCE(SUM(valor_centavos),0) FROM crediario_pagamentos WHERE venda_id=v.id) AS pago
  FROM vendas v LEFT JOIN contas_crediario c ON c.id=v.conta_crediario_id WHERE v.cancelada=0 AND v.cliente<>'' ORDER BY v.id`).all()
  .filter(v => v.credito > v.pago)
  .map(v => ({...v, chave:v.conta_crediario_id ? `conta-${v.conta_crediario_id}` : `nome-${chaveCliente(v.cliente)}`}));
}
function listarCrediario() {
 const clientes = new Map();
 for (const v of vendasEmAberto()) {
  if (!clientes.has(v.chave)) clientes.set(v.chave, {chave:v.chave, cliente:v.conta_nome || v.cliente, tipo:v.conta_tipo || null, documento:v.conta_documento || '', saldo:0, vendas:[]});
  const c = clientes.get(v.chave);
  c.saldo += v.credito - v.pago;
  c.vendas.push({id:v.id, dataHora:v.data_hora, comanda:v.comanda, valor:reais(v.credito), pago:reais(v.pago), saldo:reais(v.credito - v.pago)});
 }
 return [...clientes.values()].map(c => ({...c, saldo:reais(c.saldo)})).sort((a, b) => b.saldo - a.saldo);
}
function receberCrediario(ctx) {
 const {chave, valor, metodo} = ctx.body;
 if (typeof chave !== 'string' || !chave) falha(400,'Escolha quem está pagando.');
 if (!['Dinheiro','Pix','Débito','Crédito'].includes(metodo)) falha(400,'Escolha a forma de pagamento.');
 if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) falha(400,'Informe um valor maior que zero.');
 let restante = centavos(valor);
 transacao(() => {
  const caixa = caixaAberto();
  if (!caixa) falha(409,'Abra o caixa antes de receber.');
  const abertas = vendasEmAberto().filter(v => v.chave === chave);
  const saldo = abertas.reduce((s, v) => s + v.credito - v.pago, 0);
  if (!saldo) falha(404,'Não há nada a pagar nesta conta.');
  if (restante > saldo) falha(400,`O valor passa do que está devendo (${(saldo / 100).toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}).`);
  // Abate primeiro as compras mais antigas.
  for (const v of abertas) {
   if (!restante) break;
   const parte = Math.min(restante, v.credito - v.pago);
   db.prepare('INSERT INTO crediario_pagamentos (venda_id,caixa_id,usuario_id,metodo,valor_centavos) VALUES (?,?,?,?,?)').run(v.id, caixa.id, ctx.usuario.id, metodo, parte);
   if (parte === v.credito - v.pago) db.prepare("UPDATE vendas SET status='Quitado' WHERE id=?").run(v.id);
   restante -= parte;
  }
 });
 return {clientes:listarCrediario()};
}

// ---------- BACKUP ----------
// Uma cópia por dia em data/backups (guarda as últimas 30) e, se configurada, outra numa pasta extra
// (pen drive ou pasta do Google Drive), para não perder tudo se o computador estragar.
const pastaBackups = process.env.BACKUP_DIR || path.join(path.dirname(databasePath), 'backups');
const ARQUIVO_BACKUP = /^produtos-\d{4}-\d{2}-\d{2}\.db$/;
function lerConfiguracao(chave, padrao) {
 const row = db.prepare('SELECT valor FROM configuracao WHERE chave=?').get(chave);
 return row ? JSON.parse(row.valor) : padrao;
}
function gravarConfiguracao(chave, valor) {
 db.prepare('INSERT INTO configuracao (chave,valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor').run(chave, JSON.stringify(valor));
}
function fazerBackup() {
 fs.mkdirSync(pastaBackups, {recursive:true});
 const nome = `produtos-${hoje()}.db`;
 const destino = path.join(pastaBackups, nome);
 const temporario = destino + '.tmp';
 fs.rmSync(temporario, {force:true});
 db.exec(`VACUUM INTO '${temporario.replace(/'/g, "''")}'`);
 fs.renameSync(temporario, destino);
 const arquivos = fs.readdirSync(pastaBackups).filter(f => ARQUIVO_BACKUP.test(f)).sort();
 for (const velho of arquivos.slice(0, -30)) fs.rmSync(path.join(pastaBackups, velho), {force:true});
 const {pastaExtra = ''} = lerConfiguracao('backup', {});
 let erroExtra = '';
 if (pastaExtra) {
  try { fs.copyFileSync(destino, path.join(pastaExtra, nome)); }
  catch(e) { erroExtra = `Não foi possível copiar para a pasta extra (${e.code === 'ENOENT' ? 'pasta não encontrada: o pen drive está conectado?' : e.message}).`; }
 }
 const status = {ultimo:db.prepare("SELECT datetime('now','localtime') AS d").get().d, arquivo:nome, erroExtra};
 gravarConfiguracao('backup_status', status);
 return status;
}
function backupDoDia() {
 const status = lerConfiguracao('backup_status', {});
 if (!status.ultimo || status.ultimo.slice(0, 10) !== hoje()) {
  try { fazerBackup(); } catch(e) { console.error('Backup automático falhou:', e.message); }
 }
}
setTimeout(backupDoDia, 5000).unref();
setInterval(backupDoDia, 60 * 60 * 1000).unref();
function infoBackup() {
 fs.mkdirSync(pastaBackups, {recursive:true});
 const arquivos = fs.readdirSync(pastaBackups).filter(f => ARQUIVO_BACKUP.test(f)).sort().reverse()
  .map(f => ({nome:f, tamanho:fs.statSync(path.join(pastaBackups, f)).size}));
 return {pasta:pastaBackups, pastaExtra:lerConfiguracao('backup', {}).pastaExtra || '', status:lerConfiguracao('backup_status', null), arquivos};
}
function configurarBackup(ctx) {
 const pastaExtra = texto(ctx.body.pastaExtra, 400);
 if (pastaExtra) {
  if (!path.isAbsolute(pastaExtra)) falha(400,'Informe o caminho completo da pasta, por exemplo E:\\Backup ou C:\\Users\\voce\\Google Drive\\Backup.');
  let ok = false;
  try { ok = fs.statSync(pastaExtra).isDirectory(); } catch {}
  if (!ok) falha(400,'Pasta não encontrada. Confira o caminho (e se o pen drive está conectado).');
 }
 gravarConfiguracao('backup', {pastaExtra});
 return infoBackup();
}
function baixarBackup(ctx) {
 const nome = ctx.url.searchParams.get('arquivo') || '';
 if (!ARQUIVO_BACKUP.test(nome)) falha(400,'Arquivo inválido.');
 const caminho = path.join(pastaBackups, nome);
 if (!fs.existsSync(caminho)) falha(404,'Backup não encontrado.');
 ctx.res.writeHead(200, {'Content-Type':'application/octet-stream', 'Content-Disposition':`attachment; filename="${nome}"`, 'Cache-Control':'no-store'});
 ctx.res.end(fs.readFileSync(caminho));
 ctx.respondido = true;
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

// ---------- IMPRESSORAS ----------
// Cada destino (cozinha e caixa) pode imprimir pela janela do navegador, por uma impressora de rede (porta 9100)
// ou por uma impressora USB compartilhada no Windows. Nos dois últimos casos o servidor envia comandos ESC/POS.
const IMPRESSORA_PADRAO = {modo:'navegador', endereco:'', colunas:48, acentos:'remover', copias:1, letra:'normal'};
const CONFIG_IMPRESSORAS_PADRAO = {cozinha:{...IMPRESSORA_PADRAO, letra:'grande'}, caixa:{...IMPRESSORA_PADRAO}, cabecalho:'Delícias Açaí\nPalmas - TO', rodape:'Obrigado pela preferência!', comprovante:'perguntar'};
// Quanto a letra cresce: um bloco de nível g sai com tamanho g + aumento (mínimo 1x, máximo 8x).
const AUMENTO_LETRA = {normal:0, grande:1, extra:2};
function lerConfigImpressoras() {
 const row = db.prepare("SELECT valor FROM configuracao WHERE chave='impressoras'").get();
 const salvo = row ? JSON.parse(row.valor) : {};
 return {...CONFIG_IMPRESSORAS_PADRAO, ...salvo, cozinha:{...CONFIG_IMPRESSORAS_PADRAO.cozinha, ...salvo.cozinha}, caixa:{...CONFIG_IMPRESSORAS_PADRAO.caixa, ...salvo.caixa}};
}
function validarImpressora(i, nome) {
 if (!i || typeof i !== 'object') falha(400,`Configuração da impressora ${nome} inválida.`);
 if (!['navegador','rede','windows'].includes(i.modo)) falha(400,`Escolha como a impressora ${nome} está ligada.`);
 const endereco = texto(i.endereco, 120);
 if (i.modo === 'rede' && !/^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(endereco)) falha(400,`Informe o IP da impressora ${nome}, por exemplo 192.168.0.50 ou 192.168.0.50:9100.`);
 if (i.modo === 'windows' && !/^[\w][\w .-]{0,79}$/.test(endereco)) falha(400,`Informe o nome do compartilhamento da impressora ${nome} (letras, números, espaço, ponto ou hífen).`);
 if (![32, 42, 48].includes(i.colunas)) falha(400,'Escolha a largura do papel.');
 if (!['remover','cp850'].includes(i.acentos)) falha(400,'Escolha como imprimir os acentos.');
 if (!Number.isInteger(i.copias) || i.copias < 1 || i.copias > 3) falha(400,'O número de cópias deve ser de 1 a 3.');
 if (!Object.hasOwn(AUMENTO_LETRA, i.letra)) falha(400,'Escolha o tamanho da letra.');
 return {modo:i.modo, endereco, colunas:i.colunas, acentos:i.acentos, copias:i.copias, letra:i.letra};
}
function salvarConfigImpressoras(ctx) {
 const b = ctx.body;
 if (!['perguntar','sempre','nunca'].includes(b.comprovante)) falha(400,'Escolha quando imprimir o comprovante.');
 const config = {cozinha:validarImpressora(b.cozinha, 'da cozinha'), caixa:validarImpressora(b.caixa, 'do caixa'), cabecalho:texto(b.cabecalho, 300), rodape:texto(b.rodape, 200), comprovante:b.comprovante};
 db.prepare("INSERT INTO configuracao (chave,valor) VALUES ('impressoras',?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor").run(JSON.stringify(config));
 return config;
}
function semAcentos(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?'); }
const CP850 = {'á':0xa0,'à':0x85,'â':0x83,'ã':0xc6,'é':0x82,'ê':0x88,'í':0xa1,'ó':0xa2,'ô':0x93,'õ':0xe4,'ú':0xa3,'ü':0x81,'ç':0x87,'Á':0xb5,'À':0xb7,'Â':0xb6,'Ã':0xc7,'É':0x90,'Ê':0xd2,'Í':0xd6,'Ó':0xe0,'Ô':0xe2,'Õ':0xe5,'Ú':0xe9,'Ç':0x80,'º':0xa7,'ª':0xa6};
function codificar(s, acentos) {
 if (acentos !== 'cp850') return Buffer.from(semAcentos(s), 'ascii');
 return Buffer.from([...s].map(c => CP850[c] ?? semAcentos(c).charCodeAt(0)));
}
function quebrar(texto, largura) {
 const linhas = [];
 for (const paragrafo of texto.split('\n')) {
  let atual = '';
  for (const palavra of paragrafo.split(' ')) {
   for (let p = palavra; p.length; p = p.slice(largura)) {
    const pedaco = p.slice(0, largura);
    if (!atual) atual = pedaco;
    else if ((atual + ' ' + pedaco).length <= largura) atual += ' ' + pedaco;
    else { linhas.push(atual); atual = pedaco; }
   }
  }
  linhas.push(atual);
 }
 return linhas;
}
// O documento é uma lista de blocos montada pela tela: {t:'texto'|'par'|'linha', v, e, d, b (negrito), g (nível de tamanho 0 a 3), a ('c'|'d')}.
function validarDocumento(doc) {
 if (!Array.isArray(doc) || !doc.length || doc.length > 400) falha(400,'Nada para imprimir.');
 return doc.map(b => {
  if (!b || !['texto','par','linha'].includes(b.t)) falha(400,'Conteúdo de impressão inválido.');
  const g = b.g === true ? 1 : Number.isInteger(b.g) && b.g >= 0 && b.g <= 3 ? b.g : 0;
  return {t:b.t, v:texto(b.v, 500), e:texto(b.e, 200), d:texto(b.d, 60), b:b.b === true, g, a:['c','d'].includes(b.a) ? b.a : 'e'};
 });
}
function tamanhoLetra(nivel, cfg) { return Math.min(8, Math.max(1, nivel + (AUMENTO_LETRA[cfg.letra] ?? 0))); }
function escpos(doc, cfg) {
 const partes = [Buffer.from([0x1b, 0x40])];
 if (cfg.acentos === 'cp850') partes.push(Buffer.from([0x1b, 0x74, 2]));
 for (const b of doc) {
  const tamanho = tamanhoLetra(b.g, cfg);
  const largura = Math.max(1, Math.floor(cfg.colunas / tamanho));
  partes.push(Buffer.from([0x1b, 0x61, b.a === 'c' ? 1 : b.a === 'd' ? 2 : 0, 0x1b, 0x45, b.b ? 1 : 0, 0x1d, 0x21, ((tamanho - 1) << 4) | (tamanho - 1)]));
  let linhas;
  if (b.t === 'linha') linhas = ['-'.repeat(largura)];
  else if (b.t === 'par') { const esquerda = b.e.slice(0, Math.max(0, largura - b.d.length - 1)); linhas = [esquerda + ' '.repeat(largura - esquerda.length - b.d.length) + b.d]; }
  else linhas = quebrar(b.v, largura);
  for (const linha of linhas) partes.push(codificar(linha, cfg.acentos), Buffer.from([0x0a]));
 }
 partes.push(Buffer.from([0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0, 0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0]));
 const um = Buffer.concat(partes);
 return Buffer.concat(Array(cfg.copias).fill(um));
}
function enviarRede(endereco, dados) {
 const [host, porta = '9100'] = endereco.split(':');
 return new Promise((resolve, reject) => {
  const socket = net.createConnection({host, port:Number(porta)});
  socket.setTimeout(5000, () => socket.destroy(new Error('a impressora não respondeu')));
  socket.on('connect', () => socket.end(dados));
  socket.on('error', e => reject(new Error({ECONNREFUSED:'a impressora recusou a conexão: desligada ou IP errado', EHOSTUNREACH:'a impressora não está na rede', ENETUNREACH:'este computador está sem rede', ENOTFOUND:'endereço da impressora não encontrado', ETIMEDOUT:'a impressora não respondeu'}[e.code] || e.message)));
  socket.on('close', erro => { if (!erro) resolve(); });
 });
}
function enviarWindows(compartilhamento, dados) {
 const arquivo = path.join(os.tmpdir(), `acai-impressao-${crypto.randomBytes(6).toString('hex')}.bin`);
 fs.writeFileSync(arquivo, dados);
 return new Promise((resolve, reject) => {
  execFile('cmd.exe', ['/d', '/c', 'copy', '/b', arquivo, `\\\\localhost\\${compartilhamento}`], {windowsHide:true, timeout:15000}, (erro, saida) => {
   fs.rm(arquivo, {force:true}, () => {});
   if (erro) reject(new Error(String(saida || erro.message).trim() || 'falha ao enviar'));
   else resolve();
  });
 });
}
async function enviarParaImpressora(destino, documento) {
 const cfg = lerConfigImpressoras()[destino];
 if (cfg.modo === 'navegador') throw new Error('a impressora agora está configurada para o navegador');
 const dados = escpos(documento, cfg);
 await (cfg.modo === 'rede' ? enviarRede(cfg.endereco, dados) : enviarWindows(cfg.endereco, dados));
}
async function imprimir(ctx) {
 const destino = ctx.body.destino;
 if (!['cozinha','caixa'].includes(destino)) falha(400,'Destino de impressão inválido.');
 if (lerConfigImpressoras()[destino].modo === 'navegador') falha(409,'Esta impressora está configurada para imprimir pelo navegador.');
 const documento = validarDocumento(ctx.body.documento);
 // Só pedidos da cozinha esperam na fila: um comprovante impresso muito depois não serve mais para o cliente.
 const usarFila = destino === 'cozinha' && ctx.body.fila !== false;
 const pendentes = db.prepare("SELECT COUNT(*) AS n FROM fila_impressao WHERE destino=? AND status='pendente'").get(destino).n;
 let erro = '';
 if (!usarFila || !pendentes) {
  try { await enviarParaImpressora(destino, documento); return {impresso:true}; }
  catch(e) { erro = e.message; }
  if (!usarFila) falha(502, `Não foi possível imprimir (${erro}). Confira se a impressora está ligada e configurada.`);
 }
 // Se já há pedidos esperando, este entra atrás deles para a cozinha receber na ordem certa.
 db.prepare('INSERT INTO fila_impressao (destino,documento,descricao,tentativas,ultimo_erro) VALUES (?,?,?,?,?)').run(destino, JSON.stringify(documento), texto(ctx.body.descricao, 80), erro ? 1 : 0, erro);
 ctx.status = 202;
 return {impresso:false, naFila:true, mensagem:'A impressora da cozinha não respondeu. O pedido fica guardado e sai sozinho assim que ela voltar.'};
}

// ---------- FILA DE IMPRESSÃO ----------
const MINUTOS_NA_FILA = 30;
let processandoFila = false;
async function processarFila() {
 if (processandoFila) return;
 processandoFila = true;
 try {
  // Pedido que esperou demais provavelmente já foi feito de outro jeito: para de tentar e avisa na tela.
  db.prepare(`UPDATE fila_impressao SET status='falhou' WHERE status='pendente' AND criado_em < datetime('now','localtime','-${MINUTOS_NA_FILA} minutes')`).run();
  for (const job of db.prepare("SELECT * FROM fila_impressao WHERE status='pendente' ORDER BY id").all()) {
   try {
    await enviarParaImpressora(job.destino, JSON.parse(job.documento));
    db.prepare("UPDATE fila_impressao SET status='impresso', tentativas=tentativas+1 WHERE id=?").run(job.id);
   } catch(e) {
    db.prepare('UPDATE fila_impressao SET tentativas=tentativas+1, ultimo_erro=? WHERE id=?').run(e.message, job.id);
    break; // mantém a ordem: os próximos esperam este sair
   }
  }
 } catch(e) { console.error(e); }
 finally { processandoFila = false; }
}
setInterval(processarFila, Number(process.env.PRINT_RETRY_MS || 10000)).unref();
function filaPublica() {
 const itens = db.prepare("SELECT * FROM fila_impressao WHERE status IN ('pendente','falhou') ORDER BY id").all()
  .map(j => ({id:j.id, destino:j.destino, descricao:j.descricao, criadoEm:j.criado_em, tentativas:j.tentativas, erro:j.ultimo_erro, status:j.status}));
 return {pendentes:itens.filter(i => i.status === 'pendente').length, falharam:itens.filter(i => i.status === 'falhou').length, itens};
}
function acaoFila(ctx) {
 const id = Number(ctx.params[0]);
 const novoStatus = ctx.params[1] === 'reenviar' ? 'pendente' : 'descartado';
 const r = novoStatus === 'pendente'
  ? db.prepare("UPDATE fila_impressao SET status='pendente', criado_em=datetime('now','localtime') WHERE id=? AND status IN ('pendente','falhou')").run(id)
  : db.prepare("UPDATE fila_impressao SET status='descartado' WHERE id=? AND status IN ('pendente','falhou')").run(id);
 if (!r.changes) falha(404,'Pedido não encontrado na fila.');
 if (novoStatus === 'pendente') processarFila();
 return filaPublica();
}

// ---------- PROCURAR IMPRESSORA NA REDE ----------
// Testa a porta 9100 (padrão das impressoras de rede) em todos os endereços da rede local deste computador.
function redesLocais() {
 const bases = new Set();
 for (const lista of Object.values(os.networkInterfaces())) for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) bases.add(i.address.split('.').slice(0, 3).join('.'));
 return [...bases].slice(0, 4);
}
function portaAberta(host, porta, ms) {
 return new Promise(resolve => {
  const socket = net.createConnection({host, port:porta});
  const fim = ok => { socket.destroy(); resolve(ok); };
  socket.setTimeout(ms, () => fim(false));
  socket.on('connect', () => fim(true));
  socket.on('error', () => fim(false));
 });
}
async function procurarImpressoras() {
 const porta = Number(process.env.PRINTER_SCAN_PORT || 9100);
 const redes = redesLocais();
 const alvos = process.env.PRINTER_SCAN_TARGETS ? process.env.PRINTER_SCAN_TARGETS.split(',') : redes.flatMap(base => Array.from({length:254}, (_, i) => `${base}.${i + 1}`));
 const encontradas = [];
 for (let i = 0; i < alvos.length; i += 64) {
  const lote = alvos.slice(i, i + 64);
  const abertas = await Promise.all(lote.map(ip => portaAberta(ip, porta, 700)));
  lote.forEach((ip, j) => { if (abertas[j]) encontradas.push(porta === 9100 ? ip : `${ip}:${porta}`); });
 }
 return {redes:redes.map(b => b + '.x'), impressoras:encontradas};
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
 ['GET', /^\/api\/relatorios$/, 'admin', relatorio],
 ['GET', /^\/api\/impressoras$/, 'logado', lerConfigImpressoras],
 ['PUT', /^\/api\/impressoras$/, 'admin', salvarConfigImpressoras],
 ['POST', /^\/api\/imprimir$/, 'logado', imprimir],
 ['GET', /^\/api\/impressoras\/fila$/, 'logado', filaPublica],
 ['POST', /^\/api\/impressoras\/fila\/(\d+)\/(reenviar|descartar)$/, 'logado', acaoFila],
 ['GET', /^\/api\/impressoras\/procurar$/, 'admin', procurarImpressoras],
 ['POST', /^\/api\/caixa\/movimento$/, 'logado', movimentarCaixa],
 ['GET', /^\/api\/crediario$/, 'logado', listarCrediario],
 ['GET', /^\/api\/crediario\/contas$/, 'logado', listarContas],
 ['POST', /^\/api\/crediario\/contas$/, 'admin', salvarConta],
 ['PUT', /^\/api\/crediario\/contas\/(\d+)$/, 'admin', salvarConta],
 ['POST', /^\/api\/crediario\/receber$/, 'logado', receberCrediario],
 ['GET', /^\/api\/registro$/, 'admin', listarRegistro],
 ['GET', /^\/api\/backup$/, 'admin', infoBackup],
 ['PUT', /^\/api\/backup$/, 'admin', configurarBackup],
 ['POST', /^\/api\/backup\/agora$/, 'admin', () => { fazerBackup(); return infoBackup(); }],
 ['GET', /^\/api\/backup\/baixar$/, 'admin', baixarBackup]
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
   if (!ctx.respondido) json(res, ctx.status, resposta);
   return;
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
