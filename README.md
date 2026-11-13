# Sistema Açaí local

1. Abra `iniciar.bat` e mantenha a janela aberta enquanto usar o sistema.
2. No navegador, acesse http://localhost:3000.
3. No primeiro acesso, crie o usuário **administrador**. Depois, cadastre os atendentes na aba **Usuários**.

Não é necessário instalar bibliotecas. O servidor usa Node.js 22.13 ou superior; o iniciador também encontra o runtime disponível neste ambiente.

## Onde ficam os dados

Tudo fica no banco SQLite `data/produtos.db`, criado automaticamente neste computador: produtos, usuários, comandas abertas, vendas, pagamentos e caixas. Fechar o navegador ou reiniciar o computador não apaga nada.

O arquivo do banco não deve ser publicado junto com o código.

### Backup automático

Todo dia (e a cada fechamento de caixa) o sistema guarda uma cópia completa em `data/backups`, mantendo as últimas 30. Em **Configurações → Backup**, escolha também uma **pasta extra** (pen drive ou pasta do Google Drive para computador) para ter uma cópia fora do computador. As cópias também podem ser baixadas por ali.

Para restaurar: feche o sistema, copie o arquivo do backup para `data/produtos.db` (substituindo o atual) e abra de novo.

## Perfis de acesso

| | Atendente | Administrador |
|---|---|---|
| Comandas, pagamento, transferência | ✓ | ✓ |
| Abrir e fechar o caixa, retiradas e reforços | ✓ (contagem às cegas) | ✓ (vê a diferença) |
| Crediário: ver quem deve e receber | ✓ | ✓ |
| Histórico | Só do caixa aberto | Qualquer período, com cancelamento e itens retirados |
| Relatórios | — | ✓ |
| Produtos, usuários e configurações | — | ✓ |

## Adicionais

No cadastro de produtos, marque **"É um adicional"** nos complementos (Nutella, granola, leite Ninho…) e **"Pede adicionais ao lançar"** nos produtos que recebem complementos (açaí). Na comanda, o botão **Adicionais** do item (igual ao de observação) abre a escolha, só quando precisar; o item fica como "Açaí 500ml + Nutella + Granola", com um preço só, e assim sai na cozinha. Adicionais contam por unidade (2 açaís com Nutella = 2 Nutellas) e aparecem no relatório de produtos.

## Caixa e crediário

- **Retirada (sangria)** e **reforço (suprimento)** ficam registrados no fechamento e entram no dinheiro esperado. A retirada pede a **senha de um administrador** (mesmo com o atendente logado) e o fechamento mostra quem autorizou; o reforço não pede senha.
- **Crediário:** só para quem está cadastrado na aba Crediário: funcionários (com CPF) e a própria loja (com CNPJ). No pagamento, escolha a conta na lista. A aba mostra quem deve quanto. Ao receber, o valor abate primeiro as compras mais antigas e entra no caixa aberto pela forma de pagamento escolhida.
- **Itens retirados:** tudo que for removido ou transferido de uma comanda fica registrado (quem, quando, o quê e se já tinha ido para a cozinha). Não pede senha; o administrador consulta no Histórico.

## Relatórios

Na aba **Relatórios** o administrador escolhe o período e vê:

- **Resumo** (faturamento, vendas, ticket médio, itens por venda, descontos e canceladas), com seta comparando com o período anterior: ontem, os mesmos dias logo antes, o mesmo trecho do mês passado ("Este mês") ou do ano passado ("Este ano"). Em descontos e cancelamentos, subir aparece como ruim.
- **Gráficos de colunas:** faturamento por horário (um dia) ou por dia/mês (vários dias), média por horário e, a partir de 14 dias, média por dia da semana. Passe o mouse numa coluna para ver o valor; "Ver os números" mostra a tabela.
- **Produtos mais vendidos** (com busca e % do total), categorias, formas de pagamento e atendentes (com ticket médio).

Vendas canceladas não entram nos números.

As categorias vêm do cadastro de produtos: preencha a categoria de cada produto para o relatório de categorias funcionar.

## Impressão

Em **Configurações → Impressoras** (administrador) configure a impressora da **cozinha** (pedidos) e a do **caixa** (comprovante, que não é documento fiscal). Cada uma pode imprimir de três formas:

- **Janela do navegador:** funciona com qualquer impressora instalada no Windows.
- **Impressora de rede:** informe o IP; o sistema envia comandos ESC/POS direto pela porta 9100.
- **USB compartilhada no Windows:** compartilhe a impressora no Windows e informe o nome do compartilhamento.

Ao lado do número da comanda fica o campo **Vibra nº**, que já vem com o mesmo número; se a comanda que vibra entregue ao cliente tiver outro número, troque ali. É esse número que sai na cozinha para chamar o cliente.

Na comanda, **Imprimir** imprime só os itens marcados para a cozinha que ainda não foram enviados. O pedido da cozinha traz apenas o número da comanda, o número da comanda que vibra, os itens, as quantidades e as observações. O comprovante pode ser impresso depois do pagamento (sempre, perguntando ou nunca) e reimpresso pelo Histórico.

- **Procurar na rede:** acha sozinho as impressoras de rede (porta 9100) no mesmo Wi-Fi do computador.
- **Tamanho da letra** dos itens da cozinha: normal, grande ou extra grande.
- **Fila de reenvio:** se a impressora da cozinha estiver desligada ou sem rede, o pedido fica guardado e sai sozinho, na ordem, quando ela voltar. A barra de cima mostra quantos pedidos estão esperando. Depois de 30 minutos o sistema para de tentar e deixa o pedido na lista para reenviar ou descartar.
- **IP fixo:** reserve o IP da impressora no roteador (reserva de DHCP) para que ele não mude depois de uma queda de energia.

## Abrir sozinho com o Windows

Dê dois cliques em `inicio-automatico.bat` uma vez. A partir daí, sempre que o computador ligar, o sistema abre sozinho. Para desligar, dê dois cliques de novo. Se o servidor parar por algum erro, o `iniciar.bat` reinicia ele em 5 segundos.

## Regras

- Produtos inativos permanecem cadastrados, mas saem da busca e dos atalhos de venda. Alterar o cadastro não muda itens já lançados nas comandas.
- Para produtos por kg, informe o peso em kg na comanda (ex.: 0,350 para 350 g). Valores são arredondados em centavos por item.
- O faturamento de uma venda é o valor dos itens menos o desconto. Adiantamentos aparecem como forma de pagamento.
- O fechamento compara o dinheiro contado com o esperado (fundo de troco + vendas e crediário recebidos em dinheiro + reforços − retiradas).

Verificação: `node test.cjs` usa um banco temporário e não altera os dados reais.
