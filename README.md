# Sistema Açaí local

1. Abra `iniciar.bat` e mantenha a janela aberta enquanto usar o sistema.
2. No navegador, acesse http://localhost:3000.
3. No primeiro acesso, crie o usuário **administrador**. Depois, cadastre os atendentes na aba **Usuários**.

Não é necessário instalar bibliotecas. O servidor usa Node.js 22.13 ou superior; o iniciador também encontra o runtime disponível neste ambiente.

## Onde ficam os dados

Tudo fica no banco SQLite `data/produtos.db`, criado automaticamente neste computador: produtos, usuários, comandas abertas, vendas, pagamentos e caixas. Fechar o navegador ou reiniciar o computador não apaga nada.

Para fazer backup, encerre o servidor e copie a pasta `data` para um local seguro (pen drive, Google Drive). O arquivo do banco não deve ser publicado junto com o código.

## Perfis de acesso

| | Atendente | Administrador |
|---|---|---|
| Comandas, pagamento, transferência | ✓ | ✓ |
| Abrir e fechar o caixa | ✓ (contagem às cegas) | ✓ (vê a diferença) |
| Histórico | Só do caixa aberto | Qualquer período, com cancelamento |
| Relatórios | — | ✓ |
| Produtos e usuários | — | ✓ |

## Relatórios

Na aba **Relatórios** o administrador escolhe o período e vê: número de vendas, faturamento, ticket médio, descontos, produtos mais vendidos (com busca), categorias, formas de pagamento, vendas por dia, horários de movimento e vendas por atendente. Vendas canceladas não entram nos números.

As categorias vêm do cadastro de produtos: preencha a categoria de cada produto para o relatório de categorias funcionar.

## Regras

- Produtos inativos permanecem cadastrados, mas saem da busca e dos atalhos de venda. Alterar o cadastro não muda itens já lançados nas comandas.
- Para produtos por kg, informe o peso em kg na comanda (ex.: 0,350 para 350 g). Valores são arredondados em centavos por item.
- O faturamento de uma venda é o valor dos itens menos o desconto. Adiantamentos aparecem como forma de pagamento.
- O fechamento compara o dinheiro contado com o esperado (fundo de troco + vendas em dinheiro).

Verificação: `node test.cjs` usa um banco temporário e não altera os dados reais.
