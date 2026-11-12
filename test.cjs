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
 assert.equal((await atendente('/api/vendas','POST',{comanda:1,desconto:0,pagamentos:[{metodo:'Pix',valor:5347}]})).status, 409, 'sem caixa aberto');
 assert.equal((await atendente('/api/caixa/abrir','POST',{fundo:100})).status, 201);
 assert.equal((await admin('/api/caixa/abrir','POST',{fundo:50})).status, 409);
 assert.equal((await atendente('/api/caixa')).body.caixa.resumo, undefined, 'atendente não vê o resumo do caixa');

 // Venda: 2 x 18,00 + 0,350 kg x 49,90 (17,465 -> 17,47) = 53,47; desconto 1,00 -> 52,47.
 assert.equal((await atendente('/api/vendas','POST',{comanda:1,desconto:100,pagamentos:[{metodo:'Pix',valor:5000}]})).status, 400, 'valor insuficiente');
 assert.equal((await atendente('/api/vendas','POST',{comanda:1,desconto:100,pagamentos:[{metodo:'Pix',valor:6000}]})).status, 400, 'troco sem dinheiro');
 assert.equal((await atendente('/api/vendas','POST',{comanda:1,desconto:0,pagamentos:[{metodo:'Crediário',valor:5347}]})).status, 400, 'crediário sem cliente');
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
 assert.equal((await reaberto('/api/vendas?inicio=2000-01-01&fim=2100-01-01')).body.length, 1);
 console.log('Todos os testes passaram.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await stop();fs.rmSync(temporary,{recursive:true,force:true});});
