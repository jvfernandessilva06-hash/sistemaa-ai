# Sistema Açaí local

1. Abra `iniciar.bat` e mantenha a janela aberta enquanto usar o sistema.
2. No navegador, acesse http://localhost:3000.
3. Entre em **Cadastrar produtos** ou na aba **Produtos**.

O banco SQLite é criado automaticamente em `data/produtos.db`. Não é necessário instalar bibliotecas. O servidor usa Node.js 22.13 ou superior; o iniciador também encontra o runtime disponível neste ambiente.

Produtos são gravados no banco local. Comandas, vendas e caixa ainda usam o armazenamento do navegador, como antes. Abrir `index.html` diretamente não conecta o banco; use o endereço local. Como é outro endereço, os dados antigos de vendas do arquivo HTML não aparecem automaticamente nesse navegador/endereço.

O cadastro inclui código único, nome, preço por unidade ou kg, categoria e código de barras opcionais, envio à cozinha e status ativo/inativo. Produtos inativos permanecem cadastrados, mas saem da busca e dos atalhos de venda. Alterar o cadastro não muda itens já lançados nas comandas.

Para produtos por kg, informe o peso em kg na comanda (ex.: 0,350 para 350 g). Valores são arredondados em centavos por item.

Para copiar o banco, encerre o servidor primeiro e copie a pasta `data` para um local seguro. O arquivo do banco não deve ser publicado junto com o código.

Verificação: `node test-products.cjs` usa um banco temporário e não altera os produtos reais.
