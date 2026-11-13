// Testa o servidor com um banco temporário. Não altera os dados reais da loja.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const net = require('node:net');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'acai-teste-'));
const database = path.join(temporary,'produtos.db');
const port = 3137;
const url = `http://localhost:${port}`;
let server;
async function start() {
 server = spawn(process.execPath,['server.cjs'],{cwd:__dirname,env:{...process.env,PORT:String(port),PRODUCTS_DB:database,PRINT_RETRY_MS:'300',PRINTER_SCAN_TARGETS:'127.0.0.1',PRINTER_SCAN_PORT:'9199'},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('Servidor não iniciou')),10000); server.stdout.on('data',d=>{if(d.toString().includes('Sistema disponível')){clearTimeout(timer);resolve();}}); server.once('exit',code=>{clearTimeout(timer);reject(new Error('Servidor encerrou: '+code));}); });
}
async function stop(){if(server && server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}}
// Cada "navegador" guarda o próprio cookie de sessão.
function cliente() {
 let cookie = '';
 return async (route, method='GET', body) => {
  const r = await fetch(url+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const novo = r.headers.get('set-cookie'); if (novo) cookie = novo.split(';')[0];
  return {status:r.status, body:await r.json()};
 };
}
(async()=>{
 await start();
 const admin = cliente(), atendente = cliente(), anonimo = cliente();

 // Primeiro acesso: cria o administrador.
 assert.equal((await anonimo('/api/me')).body.configurar, true);
 assert.equal((await anonimo('/api/produtos')).status, 401);
 assert.equal((await admin('/api/setup','POST',{nome:'Dono',login:'dono',senha:'123'})).status, 400);
 const setup = await admin('/api/setup','POST',{nome:'Dono',login:'dono',senha:'senha-forte'});
 assert.equal(setup.status, 201); assert.equal(setup.body.usuario.perfil, 'admin');
 assert.equal((await anonimo('/api/setup','POST',{nome:'Outro',login:'outro',senha:'senha-forte'})).status, 409);
 assert.equal((await admin('/api/me')).body.usuario.login, 'dono');

 // Produtos.
 const produtos = (await admin('/api/produtos')).body; assert.equal(produtos.length, 6);
 const acai500 = produtos.find(p => p.codigo === '101');
 assert.equal((await admin(`/api/produtos/${acai500.id}`,'PUT',{...acai500,categoria:'Açaí'})).status, 200);
 const kg = (await admin('/api/produtos','POST',{codigo:'900',nome:'Açaí por kg',preco:49.90,unidade:'KG',categoria:'Açaí',codigoBarras:'',requerCozinha:true,ativo:true}));
 assert.equal(kg.status, 201);
 assert.equal((await admin('/api/produtos','POST',{...kg.body,codigo:'900'})).status, 409);
 for (const alteracao of [{preco:-1},{preco:1.234},{nome:' '},{unidade:'L'},{ativo:'sim'}]) assert.equal((await admin('/api/produtos','POST',{...kg.body,codigo:'901',...alteracao})).status, 400);

 // Usuários e permissões.
 assert.equal((await admin('/api/usuarios','POST',{nome:'Ana',login:'Ana Paula',senha:'123456',perfil:'atendente',ativo:true})).status, 400);
 const ana = await admin('/api/usuarios','POST',{nome:'Ana',login:'ana',senha:'123456',perfil:'atendente',ativo:true});
 assert.equal(ana.status, 201);
 assert.equal((await admin('/api/usuarios','POST',{nome:'Ana 2',login:'ANA',senha:'123456',perfil:'atendente',ativo:true})).status, 409);
 assert.equal((await atendente('/api/login','POST',{login:'ana',senha:'errada'})).status, 401);
 assert.equal((await atendente('/api/login','POST',{login:'ana',senha:'123456'})).status, 200);
 assert.equal((await atendente('/api/produtos')).status, 200);
 assert.equal((await atendente('/api/produtos','POST',{...kg.body,codigo:'902'})).status, 403);
 assert.equal((await atendente('/api/relatorios')).status, 403);
 assert.equal((await atendente('/api/usuarios')).status, 403);
 assert.equal((await atendente('/api/caixas')).status, 403);
 const dono = setup.body.usuario;
 assert.equal((await admin(`/api/usuarios/${dono.id}`,'PUT',{nome:'Dono',perfil:'atendente',ativo:true})).status, 400, 'não pode ficar sem administrador');

 // Comandas e caixa.
 const itens = [{...acai500,qtd:2,obs:'sem granola',impresso:false},{...kg.body,qtd:0.35,obs:'',impresso:false}];
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{1:{aberta:true,itens,adiantamento:0,desconto:0}}})).status, 200);
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{2:{aberta:true,itens:[{...acai500,qtd:1.5}],adiantamento:0,desconto:0}}})).status, 400);
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{51:{aberta:true,itens,adiantamento:0,desconto:0}}})).status, 400);
 assert.equal((await admin('/api/comandas')).body[1].itens.length, 2, 'comanda salva no banco aparece para outro usuário');
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{3:{aberta:true,itens,adiantamento:0,desconto:0,vibra:0}}})).status, 400, 'comanda que vibra inválida');
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{3:{aberta:true,itens,adiantamento:0,desconto:0,vibra:'7; x'}}})).status, 400);
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{3:{aberta:true,itens,adiantamento:0,desconto:0,vibra:17}}})).status, 200);
 assert.equal((await admin('/api/comandas')).body[3].vibra, 17, 'guarda o número da comanda que vibra');
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{3:{aberta:false,itens:[],adiantamento:0,desconto:0}}})).status, 200);
 // Aumentou a quantidade depois de enviar: guarda quanto já foi para a cozinha imprimir só a diferença.
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{3:{aberta:true,itens:[{...acai500,qtd:3,impresso:false,qtdImpressa:2}],adiantamento:0,desconto:0}}})).status, 200);
 assert.equal((await admin('/api/comandas')).body[3].itens[0].qtdImpressa, 2, 'guarda quanto já foi para a cozinha');
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{3:{aberta:true,itens:[{...acai500,qtd:3,impresso:false,qtdImpressa:-1}],adiantamento:0,desconto:0}}})).status, 400);
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{3:{aberta:true,itens:[{...acai500,qtd:2,impresso:false,qtdImpressa:5}],adiantamento:0,desconto:0}}})).status, 200);
 assert.equal((await admin('/api/comandas')).body[3].itens[0].impresso, true, 'se já foi tudo, fica como enviado');
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{3:{aberta:false,itens:[],adiantamento:0,desconto:0}}})).status, 200);
 assert.equal((await atendente('/api/vendas','POST',{comanda:1,desconto:0,pagamentos:[{metodo:'Pix',valor:5347}]})).status, 409, 'sem caixa aberto');
 assert.equal((await atendente('/api/caixa/abrir','POST',{fundo:100})).status, 201);
 assert.equal((await admin('/api/caixa/abrir','POST',{fundo:50})).status, 409);
 assert.equal((await atendente('/api/caixa')).body.caixa.resumo, undefined, 'atendente não vê o resumo do caixa');

 // Venda: 2 x 18,00 + 0,350 kg x 49,90 (17,465 -> 17,47) = 53,47; desconto 1,00 -> 52,47.
 assert.equal((await atendente('/api/vendas','POST',{comanda:1,desconto:100,pagamentos:[{metodo:'Pix',valor:5000}]})).status, 400, 'valor insuficiente');
 assert.equal((await atendente('/api/vendas','POST',{comanda:1,desconto:100,pagamentos:[{metodo:'Pix',valor:6000}]})).status, 400, 'troco sem dinheiro');
 assert.equal((await atendente('/api/vendas','POST',{comanda:1,desconto:0,pagamentos:[{metodo:'Crediário',valor:5347}]})).status, 400, 'crediário sem conta cadastrada');
 const venda = await atendente('/api/vendas','POST',{comanda:1,desconto:100,pagamentos:[{metodo:'Pix',valor:2000},{metodo:'Dinheiro',valor:4000}]});
 assert.equal(venda.status, 201);
 assert.equal(venda.body.subtotal, 53.47); assert.equal(venda.body.valor, 52.47); assert.equal(venda.body.troco, 7.53);
 assert.deepEqual(venda.body.pagamentos, [{metodo:'Pix',valor:20},{metodo:'Dinheiro',valor:32.47}]);
 assert.equal((await atendente('/api/comandas')).body[1].aberta, false, 'comanda liberada após o pagamento');
 assert.equal((await atendente('/api/vendas')).body.length, 1);

 // Relatórios (somente administrador).
 const rel = (await admin('/api/relatorios')).body;
 assert.equal(rel.resumo.vendas, 1); assert.equal(rel.resumo.faturamento, 52.47); assert.equal(rel.resumo.descontos, 1);
 assert.equal(rel.produtos[0].nome, 'Açaí 500ml'); assert.equal(rel.produtos[0].quantidade, 2);
 assert.deepEqual(rel.categorias.map(c => [c.categoria, c.valor]), [['Açaí', 53.47]]);
 assert.equal(rel.atendentes[0].nome, 'Ana');

 // Fechamento: fundo 100 + 32,47 em dinheiro = 132,47 esperado.
 const fechamento = await atendente('/api/caixa/fechar','POST',{contado:130,observacao:''});
 assert.equal(fechamento.status, 200); assert.equal(fechamento.body.caixa, null, 'atendente não vê a diferença');
 const caixas = (await admin('/api/caixas')).body;
 assert.equal(caixas[0].resumo.dinheiroEsperado, 132.47); assert.equal(caixas[0].resumo.diferenca, -2.47);
 assert.equal((await atendente('/api/vendas')).body.length, 0, 'sem caixa aberto, atendente não vê vendas');

 // Cancelamento sai do relatório.
 assert.equal((await atendente(`/api/vendas/${venda.body.id}/cancelar`,'POST',{motivo:'teste'})).status, 403);
 assert.equal((await admin(`/api/vendas/${venda.body.id}/cancelar`,'POST',{motivo:'Lançada errado'})).status, 200);
 const depois = (await admin('/api/relatorios')).body.resumo;
 assert.equal(depois.vendas, 0); assert.equal(depois.canceladas, 1);

 // Segundo caixa: adicionais, registro de itens retirados, crediário, sangria e suprimento.
 assert.equal((await atendente('/api/caixa/abrir','POST',{fundo:50})).status, 201);
 const nutella = produtos.find(p => p.codigo === '202'), ninho = produtos.find(p => p.codigo === '201'), agua = produtos.find(p => p.codigo === '301');
 assert.equal(nutella.adicional, true); assert.equal(acai500.aceitaAdicionais, true);
 const ad = p => ({id:p.id, codigo:p.codigo, nome:p.nome, categoria:p.categoria, preco:p.preco, qtd:1});
 const itemA = {...acai500, uid:'aaaaaa1', qtd:2, obs:'', impresso:true, adicionais:[ad(nutella), ad(ninho)]};
 const itemB = {...kg.body, uid:'bbbbbb2', qtd:0.3, obs:'', impresso:false, adicionais:[ad(nutella)]};
 const itemC = {...agua, uid:'cccccc3', qtd:1, obs:'', impresso:false};
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{4:{aberta:true,itens:[itemA,itemB,itemC],adiantamento:0,desconto:0}}})).status, 200);
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{4:{aberta:true,itens:[itemA,{...itemB,adicionais:[{...ad(nutella),qtd:99}]}],adiantamento:0,desconto:0}}})).status, 400);
 assert.equal((await atendente('/api/comandas','PUT',{comandas:{4:{aberta:true,itens:[itemA,itemB],adiantamento:0,desconto:0}}})).status, 200);
 assert.equal((await atendente('/api/registro')).status, 403);
 const registro = (await admin('/api/registro')).body;
 assert.equal(registro[0].descricao, '1x Água sem Gás'); assert.equal(registro[0].usuario, 'Ana'); assert.equal(registro[0].acao, 'removeu');
 // 2 x (18,00 + 5,00 + 3,50) = 53,00; 0,300 kg x 49,90 = 14,97 + 5,00 = 19,97; total 72,97.
 const vendaAdicionais = await atendente('/api/vendas','POST',{comanda:4,desconto:0,pagamentos:[{metodo:'Pix',valor:7297}]});
 assert.equal(vendaAdicionais.status, 201, JSON.stringify(vendaAdicionais.body));
 assert.equal(vendaAdicionais.body.subtotal, 72.97);
 assert.deepEqual(vendaAdicionais.body.itens[0].adicionais.map(a => [a.nome, a.qtd, a.total]), [['Nutella', 2, 10], ['Leite Ninho', 2, 7]]);
 assert.equal((await admin('/api/relatorios')).body.produtos.find(p => p.nome === 'Nutella').quantidade, 3, 'adicionais contam no relatório');

 // Crediário só para contas cadastradas: funcionário com CPF ou a empresa com CNPJ.
 assert.equal((await admin('/api/crediario/contas','POST',{nome:'Maria Silva',tipo:'funcionario',documento:'123.456.789-00'})).status, 400, 'CPF inválido');
 assert.equal((await atendente('/api/crediario/contas','POST',{nome:'Maria Silva',tipo:'funcionario',documento:'529.982.247-25'})).status, 403);
 assert.equal((await admin('/api/crediario/contas','POST',{nome:'Maria Silva',tipo:'funcionario',documento:'529.982.247-25'})).status, 201);
 assert.equal((await admin('/api/crediario/contas','POST',{nome:'Outra',tipo:'funcionario',documento:'52998224725'})).status, 409, 'CPF repetido');
 assert.equal((await admin('/api/crediario/contas','POST',{nome:'Delícias Açaí',tipo:'empresa',documento:'11.222.333/0001-81'})).status, 201);
 const contas = (await atendente('/api/crediario/contas')).body;
 assert.deepEqual(contas.map(c => [c.nome, c.tipo]), [['Delícias Açaí','empresa'], ['Maria Silva','funcionario']]);
 const maria = contas.find(c => c.nome === 'Maria Silva');
 // Deve 4,00, paga 1,50 em dinheiro e 2,50 no Pix.
 await atendente('/api/comandas','PUT',{comandas:{5:{aberta:true,itens:[{...itemC,uid:'dddddd4'}],adiantamento:0,desconto:0}}});
 assert.equal((await atendente('/api/vendas','POST',{comanda:5,desconto:0,pagamentos:[{metodo:'Crediário',valor:400}],cliente:'Qualquer nome'})).status, 400, 'nome solto não vale');
 const fiado = await atendente('/api/vendas','POST',{comanda:5,desconto:0,pagamentos:[{metodo:'Crediário',valor:400}],contaCrediario:maria.id});
 assert.equal(fiado.body.status, 'A receber'); assert.equal(fiado.body.cliente, 'Maria Silva');
 const devedores = (await atendente('/api/crediario')).body;
 assert.deepEqual(devedores.map(c => [c.cliente, c.saldo, c.documento]), [['Maria Silva', 4, '52998224725']]);
 const chave = devedores[0].chave;
 assert.deepEqual((await atendente('/api/crediario/receber','POST',{chave,valor:1.5,metodo:'Dinheiro'})).body.clientes.map(c => c.saldo), [2.5]);
 assert.equal((await atendente('/api/crediario/receber','POST',{chave,valor:3,metodo:'Pix'})).status, 400, 'não recebe mais do que deve');
 assert.deepEqual((await atendente('/api/crediario/receber','POST',{chave,valor:2.5,metodo:'Pix'})).body.clientes, []);
 assert.equal((await admin('/api/vendas')).body.find(v => v.id === fiado.body.id).status, 'Quitado');

 // Sangria e suprimento entram no dinheiro esperado: 50 + 1,50 (crediário) + 5 - 10 = 46,50.
 assert.equal((await atendente('/api/caixa/movimento','POST',{tipo:'sangria',valor:10,motivo:''})).status, 400, 'retirada precisa de motivo');
 assert.equal((await atendente('/api/caixa/movimento','POST',{tipo:'sangria',valor:10,motivo:'Pagou o gelo'})).status, 403, 'retirada sem senha do administrador');
 assert.equal((await atendente('/api/caixa/movimento','POST',{tipo:'sangria',valor:10,motivo:'Pagou o gelo',senhaAdmin:'123456'})).status, 403, 'senha de atendente não autoriza');
 const retirada = await atendente('/api/caixa/movimento','POST',{tipo:'sangria',valor:10,motivo:'Pagou o gelo',senhaAdmin:'senha-forte'});
 assert.equal(retirada.status, 201);
 assert.equal(retirada.body.caixa.movimentos[0].autorizadoPor, 'Dono', 'guarda quem autorizou');
 const suprimento = await atendente('/api/caixa/movimento','POST',{tipo:'suprimento',valor:5,motivo:''});
 assert.equal(suprimento.body.caixa.movimentos.length, 2); assert.equal(suprimento.body.caixa.movimentos[1].autorizadoPor, null, 'reforço não pede senha'); assert.equal(suprimento.body.caixa.resumo, undefined);
 await atendente('/api/caixa/fechar','POST',{contado:46.5,observacao:''});
 const caixa2 = (await admin('/api/caixas')).body[0].resumo;
 assert.equal(caixa2.dinheiroEsperado, 46.5); assert.equal(caixa2.diferenca, 0); assert.equal(caixa2.sangrias, 10);

 // Backup: cópia do banco, download e pasta extra.
 assert.equal((await atendente('/api/backup')).status, 403);
 const backup = (await admin('/api/backup/agora','POST',{})).body;
 assert.equal(backup.arquivos.length, 1); assert.equal(backup.status.erroExtra, '');
 const baixado = await fetch(url + '/api/backup/baixar?arquivo=' + backup.arquivos[0].nome, {headers:{Cookie:(await admin('/api/me'), '')}});
 assert.equal(baixado.status, 401, 'download exige login');
 assert.equal((await admin('/api/backup','PUT',{pastaExtra:'pasta-relativa'})).status, 400);
 const extra = fs.mkdtempSync(path.join(os.tmpdir(),'acai-extra-'));
 assert.equal((await admin('/api/backup','PUT',{pastaExtra:extra})).status, 200);
 await admin('/api/backup/agora','POST',{});
 const copia = fs.readdirSync(extra);
 assert.equal(copia.length, 1); assert.ok(fs.readFileSync(path.join(extra, copia[0])).subarray(0, 15).toString() === 'SQLite format 3', 'cópia é um banco SQLite');
 fs.rmSync(extra, {recursive:true, force:true});

 // Impressão: uma impressora de rede falsa recebe os comandos ESC/POS.
 const recebido = [];
 // A busca na rede também conecta na porta sem mandar nada: essas conexões vazias são ignoradas.
 const ligarImpressora = () => new Promise(r => { const s = net.createServer(c => { const partes = []; c.on('data', d => partes.push(d)); c.on('end', () => { if (partes.length) recebido.push(Buffer.concat(partes)); }); c.on('error', () => {}); }); s.listen(9199, '127.0.0.1', () => r(s)); });
 let impressora = await ligarImpressora();
 const config = (await atendente('/api/impressoras')).body;
 assert.equal(config.cozinha.modo, 'navegador');
 const documento = [{t:'texto',v:'COMANDA 07',g:true,b:true,a:'c'},{t:'linha'},{t:'texto',v:'2x Açaí 500ml'},{t:'par',e:'Total',d:'R$ 36,00'}];
 assert.equal((await atendente('/api/imprimir','POST',{destino:'cozinha',documento})).status, 409, 'modo navegador imprime pela tela');
 assert.equal((await atendente('/api/impressoras','PUT',{...config})).status, 403);
 assert.equal((await admin('/api/impressoras','PUT',{...config,cozinha:{...config.cozinha,modo:'rede',endereco:'1.2.3.4; rm -rf'}})).status, 400);
 assert.equal((await admin('/api/impressoras','PUT',{...config,cozinha:{...config.cozinha,modo:'rede',endereco:'127.0.0.1:9199',acentos:'cp850',copias:2}})).status, 200);
 assert.equal((await atendente('/api/imprimir','POST',{destino:'cozinha',documento})).status, 200);
 await new Promise(r => setTimeout(r, 200));
 const bytes = recebido[0];
 assert.ok(bytes.includes(Buffer.from('COMANDA 07')), 'texto chegou na impressora');
 assert.ok(bytes.includes(Buffer.from([0x41, 0x87, 0x61, 0xa1])), 'Açaí em CP850');
 assert.equal(bytes.filter((b, i) => b === 0x1d && bytes[i + 1] === 0x56).length, 2, 'duas cópias, cada uma com corte');
 assert.ok(bytes.includes(Buffer.from('Total' + ' '.repeat(48 - 5 - 8) + 'R$ 36,00')), 'par alinhado em 48 colunas');
 assert.ok(bytes.includes(Buffer.from([0x1d, 0x21, 0x11])), 'letra grande: nível 1 sai em tamanho 2');
 assert.deepEqual((await admin('/api/impressoras/procurar')).body.impressoras, ['127.0.0.1:9199'], 'acha a impressora na rede');
 assert.equal((await atendente('/api/impressoras/procurar')).status, 403);

 // Impressora desligada: o teste falha na hora, mas o pedido da cozinha espera na fila e sai quando ela volta.
 await new Promise(r => impressora.close(r));
 assert.equal((await atendente('/api/imprimir','POST',{destino:'cozinha',documento,fila:false})).status, 502, 'teste de impressão não entra na fila');
 const naFila = await atendente('/api/imprimir','POST',{destino:'cozinha',documento,descricao:'Pedido comanda 07'});
 assert.equal(naFila.status, 202); assert.equal(naFila.body.naFila, true);
 assert.equal((await atendente('/api/imprimir','POST',{destino:'cozinha',documento:[{t:'texto',v:'SEGUNDO'}],descricao:'Pedido comanda 08'})).status, 202, 'entra atrás do primeiro');
 assert.equal((await atendente('/api/impressoras/fila')).body.pendentes, 2);
 const antes = recebido.length;
 impressora = await ligarImpressora();
 for (let i = 0; i < 40 && (await atendente('/api/impressoras/fila')).body.pendentes; i++) await new Promise(r => setTimeout(r, 100));
 await new Promise(r => setTimeout(r, 200));
 assert.equal((await atendente('/api/impressoras/fila')).body.pendentes, 0, 'fila esvaziou sozinha');
 assert.equal(recebido.length, antes + 2);
 assert.ok(recebido[antes].includes(Buffer.from('COMANDA 07')) && recebido[antes + 1].includes(Buffer.from('SEGUNDO')), 'saíram na ordem');
 await new Promise(r => impressora.close(r));
 const descartar = await atendente('/api/imprimir','POST',{destino:'cozinha',documento});
 assert.equal(descartar.status, 202);
 const id = (await atendente('/api/impressoras/fila')).body.itens[0].id;
 assert.equal((await atendente(`/api/impressoras/fila/${id}/descartar`,'POST',{})).body.pendentes, 0);

 assert.equal((await admin(`/api/usuarios/${ana.body.id}`,'PUT',{nome:'Ana',perfil:'atendente',ativo:false})).status, 200);
 assert.equal((await atendente('/api/produtos')).status, 401);
 assert.equal((await admin('/api/logout','POST',{})).status, 200);
 assert.equal((await admin('/api/me')).body.usuario, null);

 // O arquivo do banco não pode ser baixado.
 assert.equal((await fetch(url+'/data/produtos.db')).status, 404);

 await stop();
 await start(); // os dados continuam depois de reiniciar
 const reaberto = cliente();
 assert.equal((await reaberto('/api/login','POST',{login:'dono',senha:'senha-forte'})).status, 200);
 assert.equal((await reaberto('/api/produtos')).body.length, 7);
 assert.equal((await reaberto('/api/vendas?inicio=2000-01-01&fim=2100-01-01')).body.length, 3);
 console.log('Todos os testes passaram.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await stop();fs.rmSync(temporary,{recursive:true,force:true});});
