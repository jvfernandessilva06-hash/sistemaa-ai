const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const root = __dirname;
const port = Number(process.env.PORT || 3000);
const databasePath = process.env.PRODUCTS_DB || path.join(root, 'data', 'produtos.db');
fs.mkdirSync(path.dirname(databasePath), {recursive:true});
const db = new DatabaseSync(databasePath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS produtos (
 id INTEGER PRIMARY KEY,
 codigo TEXT NOT NULL COLLATE NOCASE UNIQUE,
 nome TEXT NOT NULL,
 preco_centavos INTEGER NOT NULL CHECK(preco_centavos >= 0),
 unidade TEXT NOT NULL CHECK(unidade IN ('UN', 'KG')),
 categoria TEXT NOT NULL DEFAULT '',
 codigo_barras TEXT NOT NULL DEFAULT '',
 requer_cozinha INTEGER NOT NULL CHECK(requer_cozinha IN (0,1)),
 ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)),
 criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS configuracao (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);`);
// Inserção única dos produtos que já existiam no site.
if (!db.prepare("SELECT 1 FROM configuracao WHERE chave='produtos_iniciais'").get()) {
 const inserir = db.prepare('INSERT OR IGNORE INTO produtos (codigo,nome,preco_centavos,unidade,requer_cozinha) VALUES (?,?,?,?,?)');
 db.exec('BEGIN');
 try {
  for (const p of [['101','Açaí 500ml',1800,1],['102','Açaí 300ml',1300,1],['201','Leite Ninho',350,1],['202','Nutella',500,1],['301','Água sem Gás',400,0],['302','Coca-Cola Lata',600,0]]) inserir.run(p[0],p[1],p[2],'UN',p[3]);
  db.prepare("INSERT INTO configuracao VALUES ('produtos_iniciais','1')").run();
  db.exec('COMMIT');
 } catch(e) { db.exec('ROLLBACK'); throw e; }
}
function produto(row) {
 return {id:row.id,codigo:row.codigo,nome:row.nome,preco:row.preco_centavos/100,unidade:row.unidade,categoria:row.categoria,codigoBarras:row.codigo_barras,requerCozinha:!!row.requer_cozinha,ativo:!!row.ativo};
}
function validar(body) {
 const codigo = typeof body.codigo==='string' ? body.codigo.trim() : '';
 const nome = typeof body.nome==='string' ? body.nome.trim() : '';
 if (!codigo || codigo.length>40) throw new Error('Informe um código de até 40 caracteres.');
 if (!nome || nome.length>120) throw new Error('Informe um nome de até 120 caracteres.');
 if (typeof body.preco!=='number' || !Number.isFinite(body.preco) || body.preco<0 || body.preco>999999.99 || Math.abs(body.preco*100-Math.round(body.preco*100))>0.00001) throw new Error('Informe um preço válido com até duas casas decimais.');
 if (!['UN','KG'].includes(body.unidade)) throw new Error('Selecione unidade ou kg.');
 if (typeof body.requerCozinha!=='boolean' || typeof body.ativo!=='boolean') throw new Error('Informe o status e o envio à cozinha.');
 for (const campo of ['categoria','codigoBarras']) if (body[campo]!==undefined && (typeof body[campo]!=='string' || body[campo].length>80)) throw new Error('Categoria e código de barras devem ter até 80 caracteres.');
 return [codigo,nome,Math.round(body.preco*100),body.unidade,(body.categoria||'').trim(),(body.codigoBarras||'').trim(),Number(body.requerCozinha),Number(body.ativo)];
}
function json(res,status,body) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); }
async function lerBody(req) {
 let texto='';
 for await (const chunk of req) { texto+=chunk; if (Buffer.byteLength(texto)>16384) throw new Error('Cadastro muito grande.'); }
 try { const body=JSON.parse(texto); if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error(); return body; }
 catch { throw new Error('Dados de cadastro inválidos.'); }
}
const arquivos = {'/':'index.html','/index.html':'index.html','/script.js':'script.js','/style.css':'style.css'};
const tipos={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try {
  if (![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host)) return json(res,403,{erro:'Acesso permitido apenas neste computador.'});
  const url=new URL(req.url,`http://localhost:${port}`);
  if (url.pathname==='/api/produtos' && req.method==='GET') return json(res,200,db.prepare('SELECT * FROM produtos ORDER BY nome COLLATE NOCASE').all().map(produto));
  const match=url.pathname.match(/^\/api\/produtos\/(\d+)$/);
  if ((url.pathname==='/api/produtos' && req.method==='POST') || (match && req.method==='PUT')) {
   if (req.headers.origin && ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)) return json(res,403,{erro:'Origem não permitida.'});
   if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{erro:'Envie os dados em JSON.'});
   let campos;
   try { campos=validar(await lerBody(req)); } catch(e) { return json(res,400,{erro:e.message}); }
   try {
    let id;
    if (match) {
     id=Number(match[1]);
     const result=db.prepare('UPDATE produtos SET codigo=?,nome=?,preco_centavos=?,unidade=?,categoria=?,codigo_barras=?,requer_cozinha=?,ativo=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?').run(...campos,id);
     if (!result.changes) return json(res,404,{erro:'Produto não encontrado.'});
    } else id=Number(db.prepare('INSERT INTO produtos (codigo,nome,preco_centavos,unidade,categoria,codigo_barras,requer_cozinha,ativo) VALUES (?,?,?,?,?,?,?,?)').run(...campos).lastInsertRowid);
    return json(res,match?200:201,produto(db.prepare('SELECT * FROM produtos WHERE id=?').get(id)));
   } catch(e) {
    if (e.message.includes('UNIQUE')) return json(res,409,{erro:'Este código já está cadastrado. Use outro código.'});
    throw e;
   }
  }
  if (req.method==='GET' && arquivos[url.pathname]) {
   const filename=arquivos[url.pathname];
   res.writeHead(200,{'Content-Type':tipos[path.extname(filename)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
   return res.end(fs.readFileSync(path.join(root,filename)));
  }
  json(res,404,{erro:'Endereço não encontrado.'});
 } catch(e) { console.error(e); if (!res.headersSent) json(res,500,{erro:'Não foi possível acessar o banco de produtos.'}); else res.end(); }
});
server.listen(port,'127.0.0.1',()=>console.log(`Sistema disponível em http://localhost:${port}\nBanco de produtos: ${databasePath}`));
server.on('error',e=>{ console.error(e.code==='EADDRINUSE'?'A porta já está em uso. Feche a outra execução do sistema ou use outra porta.':e.message); db.close(); process.exitCode=1; });
function encerrar(){ server.close(()=>{ db.close(); process.exit(); }); }
process.on('SIGINT',encerrar); process.on('SIGTERM',encerrar);
