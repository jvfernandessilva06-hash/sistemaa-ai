const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'acai-produtos-'));
const database = path.join(temporary,'produtos.db');
const port = 3137;
const url = `http://localhost:${port}`;
let server;
async function start() {
 server = spawn(process.execPath,['server.cjs'],{cwd:__dirname,env:{...process.env,PORT:String(port),PRODUCTS_DB:database},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('Servidor não iniciou')),10000); server.stdout.on('data',d=>{if(d.toString().includes('Sistema disponível')){clearTimeout(timer);resolve();}}); server.once('exit',code=>{clearTimeout(timer);reject(new Error('Servidor encerrou: '+code));}); });
}
async function stop(){if(server && server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}}
async function request(route,method='GET',body){const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
(async()=>{
 await start();
 assert.equal((await request('/api/produtos')).body.length,6);
 const produto={codigo:'900',nome:'Açaí por kg',preco:49.90,unidade:'KG',categoria:'Açaí',codigoBarras:'789900',requerCozinha:true,ativo:true};
 const criado=await request('/api/produtos','POST',produto);assert.equal(criado.status,201);
 assert.equal((await request('/api/produtos','POST',{...produto,codigo:'900'})).status,409);
 for(const alteracao of [{preco:-1},{preco:1.234},{nome:' '},{unidade:'L'},{ativo:'sim'}]) assert.equal((await request('/api/produtos','POST',{...produto,codigo:'901',...alteracao})).status,400);
 assert.equal((await fetch(url+'/data/produtos.db')).status,404);
 assert.equal((await fetch(url+'/api/produtos',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify(produto)})).status,403);
 const editado=await request('/api/produtos/'+criado.body.id,'PUT',{...produto,nome:'Açaí a granel',preco:55,ativo:false}); assert.equal(editado.body.ativo,false);
 await stop();await start();
 const persistido=(await request('/api/produtos')).body.find(p=>p.id===criado.body.id);assert.equal(persistido.preco,55);assert.equal(persistido.ativo,false);
 console.log('OK: cadastro, código único, validação, edição, inativação, proteção do arquivo e persistência após reiniciar.');
 // Exercita a tela e a venda por peso usando um banco descartável.
 let chromium;
 try { ({chromium}=require('playwright')); } catch {
  try { ({chromium}=require(path.join(path.dirname(process.execPath),'..','node_modules','playwright'))); } catch { console.log('Testes da API concluídos; testes visuais exigem Playwright.'); return; }
 }
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:1366,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>produtosConectados);
  await page.getByRole('button',{name:'Cadastrar produtos',exact:true}).click();
  await page.locator('#produto-nome').fill('Açaí teste por peso');await page.locator('#produto-codigo').fill('902');await page.locator('#produto-unidade').selectOption('KG');await page.locator('#produto-preco').fill('49.90');await page.locator('#produto-barras').fill('789902');await page.locator('#produto-cozinha').check();
  await page.getByRole('button',{name:'Salvar produto',exact:true}).click();await page.getByRole('button',{name:'Editar Açaí teste por peso',exact:true}).waitFor();
  await page.locator('#produto-nome').fill('Duplicado');await page.locator('#produto-codigo').fill('902');await page.locator('#produto-preco').fill('10');await page.getByRole('button',{name:'Salvar produto',exact:true}).click();await page.waitForFunction(()=>document.getElementById('produto-erro').textContent.includes('já está'));
  await page.getByRole('button',{name:'Editar Açaí teste por peso',exact:true}).click();await page.locator('#produto-ativo').uncheck();await page.getByRole('button',{name:'Salvar produto',exact:true}).click();await page.waitForFunction(()=>produtosBase.find(p=>p.codigo==='902').ativo===false);
  assert.equal(await page.getByRole('button',{name:'+ Açaí teste por peso / kg',exact:true}).count(),0);
  await page.getByRole('button',{name:'Editar Açaí teste por peso',exact:true}).click();await page.locator('#produto-ativo').check();await page.getByRole('button',{name:'Salvar produto',exact:true}).click();await page.waitForFunction(()=>produtosBase.find(p=>p.codigo==='902').ativo);
  await page.screenshot({path:'preview-produtos.png',fullPage:true});
  await page.evaluate(()=>voltarTelaInicial());await page.getByRole('button',{name:'Ir para Frente de Caixa'}).click();await page.getByRole('button',{name:'Abrir Caixa e Entrar'}).click();await page.locator('.comanda-card').first().click();
  const bala={codigo:'B2',nome:'Bala',preco:1,unidade:'UN',categoria:'',codigoBarras:'789222',requerCozinha:false,ativo:true};
  await request('/api/produtos','POST',bala);
  await request('/api/produtos','POST',{...bala,codigo:'B20',nome:'Bala de coco',codigoBarras:'789223'});
  await request('/api/produtos','POST',{...bala,codigo:'B21',nome:'Bala inativa',ativo:false,codigoBarras:''});
  await page.evaluate(()=>carregarProdutos());
  for (const termo of ['bala','BALA','BaLa']) {
    await page.locator('#input-item-modal').fill(termo);
    assert.equal(await page.locator('.search-result').count(),2);
  }
  await page.locator('#input-item-modal').press('Enter');
  assert.equal(await page.evaluate(()=>comandas[1].itens[0].nome),'Bala');
  await page.evaluate(()=>removerItem(0));
  await page.locator('#input-item-modal').fill('b2');
  assert.equal(await page.locator('.search-result').count(),2);
  await page.locator('#input-item-modal').press('Enter');
  assert.equal(await page.evaluate(()=>comandas[1].itens[0].codigo),'B2');
  await page.evaluate(()=>removerItem(0));
  await page.locator('#input-item-modal').fill('B');
  await page.getByRole('button',{name:'+ Adicionar',exact:true}).click();
  assert.equal(await page.evaluate(()=>comandas[1].itens.length),0);
  assert.match(await page.locator('#busca-produtos-status').innerText(),/mais de um/);
  await page.locator('.search-result').filter({hasText:'Bala de coco'}).click();
  assert.equal(await page.evaluate(()=>comandas[1].itens[0].codigo),'B20');
  await page.evaluate(()=>removerItem(0));
  await page.locator('#input-item-modal').fill('acai');
  assert.ok(await page.locator('.search-result').count()>=2);
  await page.locator('#input-item-modal').fill('produto inexistente');
  assert.equal(await page.locator('.search-result').count(),0);
  assert.match(await page.locator('#busca-produtos-status').innerText(),/Nenhum produto/);
  await page.locator('#input-item-modal').fill('789902');await page.getByRole('button',{name:'+ Adicionar',exact:true}).click();
  await page.locator('.item-quantity').fill('0.350');await page.locator('.item-quantity').press('Tab');assert.match(await page.locator('#summary-total').innerText(),/17,47/);
  await page.getByRole('button',{name:'Transferir itens',exact:true}).click();await page.locator('#transferencia-itens input').fill('0.150');await page.locator('#transferencia-destino').selectOption('2');await page.getByRole('button',{name:'Confirmar transferência'}).click();assert.equal(await page.evaluate(()=>comandas[1].itens[0].qtd),0.2);assert.equal(await page.evaluate(()=>comandas[2].itens[0].qtd),0.15);
  await page.evaluate(()=>fecharModal());await page.reload();await page.waitForFunction(()=>produtosConectados);assert.equal(await page.evaluate(()=>produtosBase.find(p=>p.codigo==='902').preco),49.9);
  await page.getByRole('button',{name:'Cadastrar produtos',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'preview-produtos-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('OK: busca por nome, código, código parcial, acentos, maiúsculas/minúsculas, seleção ambígua e inativos; tela de cadastro, edição, duplicado, venda por código de barras e kg, transferência fracionada e celular.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await stop();for(const nome of fs.readdirSync(temporary)) fs.unlinkSync(path.join(temporary,nome));fs.rmdirSync(temporary);});
