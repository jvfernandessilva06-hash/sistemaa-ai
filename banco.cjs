const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Cria (ou atualiza) todas as tabelas do sistema. Bancos antigos, que só tinham produtos, continuam funcionando.
function abrirBanco(caminho) {
 fs.mkdirSync(path.dirname(caminho), {recursive:true});
 const db = new DatabaseSync(caminho);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
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
CREATE TABLE IF NOT EXISTS configuracao (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usuarios (
 id INTEGER PRIMARY KEY,
 nome TEXT NOT NULL,
 login TEXT NOT NULL COLLATE NOCASE UNIQUE,
 senha_hash TEXT NOT NULL,
 perfil TEXT NOT NULL CHECK(perfil IN ('admin','atendente')),
 ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)),
 criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessoes (
 token_hash TEXT PRIMARY KEY,
 usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 expira_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS caixas (
 id INTEGER PRIMARY KEY,
 aberto_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
 aberto_por INTEGER NOT NULL REFERENCES usuarios(id),
 fundo_centavos INTEGER NOT NULL CHECK(fundo_centavos >= 0),
 fechado_em TEXT,
 fechado_por INTEGER REFERENCES usuarios(id),
 contado_centavos INTEGER,
 observacao TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS comandas (
 numero INTEGER PRIMARY KEY CHECK(numero BETWEEN 1 AND 50),
 dados TEXT NOT NULL,
 atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS vendas (
 id INTEGER PRIMARY KEY,
 caixa_id INTEGER NOT NULL REFERENCES caixas(id),
 usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 comanda INTEGER NOT NULL,
 data_hora TEXT NOT NULL DEFAULT (datetime('now','localtime')),
 subtotal_centavos INTEGER NOT NULL,
 desconto_centavos INTEGER NOT NULL DEFAULT 0,
 adiantamento_centavos INTEGER NOT NULL DEFAULT 0,
 total_centavos INTEGER NOT NULL,
 recebido_centavos INTEGER NOT NULL DEFAULT 0,
 troco_centavos INTEGER NOT NULL DEFAULT 0,
 cliente TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL,
 cancelada INTEGER NOT NULL DEFAULT 0 CHECK(cancelada IN (0,1)),
 cancelada_em TEXT,
 cancelada_por INTEGER REFERENCES usuarios(id),
 motivo_cancelamento TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS vendas_data ON vendas(data_hora);
CREATE INDEX IF NOT EXISTS vendas_caixa ON vendas(caixa_id);
CREATE TABLE IF NOT EXISTS venda_itens (
 id INTEGER PRIMARY KEY,
 venda_id INTEGER NOT NULL REFERENCES vendas(id),
 produto_id INTEGER,
 codigo TEXT NOT NULL DEFAULT '',
 nome TEXT NOT NULL,
 categoria TEXT NOT NULL DEFAULT '',
 unidade TEXT NOT NULL,
 quantidade REAL NOT NULL,
 preco_centavos INTEGER NOT NULL,
 total_centavos INTEGER NOT NULL,
 observacao TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS venda_itens_venda ON venda_itens(venda_id);
CREATE TABLE IF NOT EXISTS venda_pagamentos (
 id INTEGER PRIMARY KEY,
 venda_id INTEGER NOT NULL REFERENCES vendas(id),
 metodo TEXT NOT NULL,
 valor_centavos INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS venda_pagamentos_venda ON venda_pagamentos(venda_id);
CREATE TABLE IF NOT EXISTS fila_impressao (
 id INTEGER PRIMARY KEY,
 destino TEXT NOT NULL,
 documento TEXT NOT NULL,
 descricao TEXT NOT NULL DEFAULT '',
 criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
 tentativas INTEGER NOT NULL DEFAULT 0,
 ultimo_erro TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','impresso','falhou','descartado'))
);
CREATE TABLE IF NOT EXISTS movimentos_caixa (
 id INTEGER PRIMARY KEY,
 caixa_id INTEGER NOT NULL REFERENCES caixas(id),
 usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 tipo TEXT NOT NULL CHECK(tipo IN ('sangria','suprimento')),
 valor_centavos INTEGER NOT NULL CHECK(valor_centavos > 0),
 motivo TEXT NOT NULL DEFAULT '',
 data_hora TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS crediario_pagamentos (
 id INTEGER PRIMARY KEY,
 venda_id INTEGER NOT NULL REFERENCES vendas(id),
 caixa_id INTEGER NOT NULL REFERENCES caixas(id),
 usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 metodo TEXT NOT NULL,
 valor_centavos INTEGER NOT NULL CHECK(valor_centavos > 0),
 data_hora TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS crediario_pagamentos_venda ON crediario_pagamentos(venda_id);
CREATE TABLE IF NOT EXISTS registro_comandas (
 id INTEGER PRIMARY KEY,
 data_hora TEXT NOT NULL DEFAULT (datetime('now','localtime')),
 usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 comanda INTEGER NOT NULL,
 acao TEXT NOT NULL,
 descricao TEXT NOT NULL,
 enviado_cozinha INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS registro_comandas_data ON registro_comandas(data_hora);`);
 // Campos adicionados depois da primeira versão: bancos antigos ganham as colunas sem perder dados.
 const colunas = tabela => db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
 if (!colunas('produtos').includes('adicional')) {
  db.exec(`ALTER TABLE produtos ADD COLUMN adicional INTEGER NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN aceita_adicionais INTEGER NOT NULL DEFAULT 0;
UPDATE produtos SET adicional=1, categoria=CASE WHEN categoria='' THEN 'Adicionais' ELSE categoria END WHERE codigo IN ('201','202');
UPDATE produtos SET aceita_adicionais=1, categoria=CASE WHEN categoria='' THEN 'Açaí' ELSE categoria END WHERE codigo IN ('101','102');`);
 }
 if (!colunas('venda_itens').includes('adicional_de')) db.exec('ALTER TABLE venda_itens ADD COLUMN adicional_de INTEGER REFERENCES venda_itens(id)');
 // Inserção única dos produtos que já existiam no site.
 if (!db.prepare("SELECT 1 FROM configuracao WHERE chave='produtos_iniciais'").get()) {
  const inserir = db.prepare("INSERT OR IGNORE INTO produtos (codigo,nome,preco_centavos,unidade,requer_cozinha,categoria,adicional,aceita_adicionais) VALUES (?,?,?,'UN',?,?,?,?)");
  db.exec('BEGIN');
  try {
   for (const p of [['101','Açaí 500ml',1800,1,'Açaí',0,1],['102','Açaí 300ml',1300,1,'Açaí',0,1],['201','Leite Ninho',350,1,'Adicionais',1,0],['202','Nutella',500,1,'Adicionais',1,0],['301','Água sem Gás',400,0,'Bebidas',0,0],['302','Coca-Cola Lata',600,0,'Bebidas',0,0]]) inserir.run(...p);
   db.prepare("INSERT INTO configuracao VALUES ('produtos_iniciais','1')").run();
   db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
 }
 return db;
}

module.exports = { abrirBanco };
