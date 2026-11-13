# Sistema Açaí PDV

Caixa (PDV) da **Delícias Açaí Palmas** (Palmas-TO, loja com CNPJ). Roda num único computador do caixa; o dono (João) usa no dia a dia e decide as regras. Converse com ele em português, sem jargão.

## Antes de qualquer correção

Use a skill **triagem-correcao** (avaliar → corrigir → provar). Nada de mexer em código antes de achar a causa, e nada de dizer "corrigido" sem prova.

## Como o projeto é feito

- **Sem framework e sem dependências:** HTML/CSS/JS puros no navegador e Node.js puro no servidor (`node:http`, `node:sqlite`, `node:net`). Node 22.13+ (a máquina tem Node 24). Não adicione pacotes npm sem pedir.
- `server.cjs`: todas as rotas da API (lista `rotas` no fim do arquivo), regras de negócio, impressão ESC/POS, fila de impressão, backup, crediário, relatórios.
- `banco.cjs`: cria as tabelas e faz as migrações (colunas novas via `ALTER TABLE` checando `PRAGMA table_info`). Banco em `data/produtos.db` (fora do Git).
- `script.js`: toda a tela. `index.html`: estrutura. `style.css`: arquivo único, tokens em `:root`.
- `test.cjs`: testes do servidor com banco temporário e uma impressora de rede falsa.
- `iniciar.bat` sobe o servidor (reinicia se cair) e abre o navegador; `inicio-automatico.bat` liga/desliga o início com o Windows.

## Convenções

- Nomes de funções e variáveis em português, no estilo compacto que já existe nos arquivos.
- **Dinheiro em centavos** (inteiros) no banco e nas contas; a API recebe/devolve reais, exceto `desconto` e `pagamentos[].valor` de `/api/vendas`, que vão em centavos.
- O servidor valida tudo; a tela nunca é a única proteção. Perfis: `admin` e `atendente` (rotas marcadas `'admin'`).
- Toda mensagem de erro para o usuário em português claro.
- Janelas: use `dialogo()` / `avisar()`; nunca `prompt`, `alert` ou `confirm`.
- Acessibilidade: botões de ícone com `aria-label`, nada indicado só por cor.

## Decisões do dono (não mudar sem ele pedir)

- Remover item da comanda **não pede senha**; só fica registrado em `registro_comandas`.
- **Retirada de dinheiro (sangria) pede a senha de um administrador**; o reforço (suprimento) não pede. Quem autorizou fica em `movimentos_caixa.autorizado_por`.
- **Sem cupom de "cancelado"** para a cozinha.
- Pedido da cozinha: só número da comanda, número da comanda que vibra (campo "Vibra nº" ao lado do título; padrão = número da comanda), itens, quantidades, adicionais e observações (sem loja, preço, hora ou atendente).
- **Adicionais são opcionais**: só abrem pelo botão "Adicionais" do item, nunca sozinhos.
- **Crediário só para contas cadastradas**: funcionários (CPF) e a própria loja (CNPJ).
- A frente de caixa precisa mostrar **as 50 comandas sem rolar** num notebook (1366×650), 10 × 5. O dono achou "grande demais" tanto a versão maior quanto a de 6 colunas com rolagem (13/11/2026).
- **Visual ≠ tamanho:** mudanças de visual mexem só em cores e formatos; tamanhos de letra, espaços e medidas ficam como estão (base 14px). Nenhuma tela deve precisar rolar no notebook, e a barra de cima fica numa linha só (Configurações é só a engrenagem).
- Visual do designer (telas de 13/11/2026): fundo roxo com cachos de açaí, cartões roxo-escuro, verde para ações, laranja para sair/cancelar/remover, títulos e botões em caixa alta; janelas verdes com painéis brancos. Logo oficial em `logo.png` (fundo transparente); o fundo é SVG em `--desenho` no `style.css`. Telas novas seguem esse padrão.
- Sem atalhos de produto no topo da comanda; a busca inteligente resolve.
- **Estoque e delivery estão fora do sistema.**

## Como provar que funciona

1. `node test.cjs` precisa terminar com `Todos os testes passaram.`
2. Para ver na tela **sem tocar nos dados reais**, suba uma cópia de teste:
   `$env:PORT='3150'; $env:PRODUCTS_DB="$env:TEMP\acai-preview\produtos.db"; node server.cjs`
   e abra `http://localhost:3150` (crie o admin de teste pela API `/api/setup`). Apague `$env:TEMP\acai-preview` depois.
3. Nunca edite `data/produtos.db` direto, nunca crie usuários ou senhas no banco real; o admin real é do dono.
4. Depois de mudar o servidor, reinicie o sistema da loja (porta 3000) para ele usar o código novo.

## Git

- O dono quer **commit e push direto na `main`**.
- No PowerShell 5.1, mensagens de commit com aspas quebram: grave a mensagem num arquivo UTF-8 **sem BOM** em `$env:TEMP` e use `git commit -F`.
- Termine a mensagem com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Pendências

- **NFC-e** (prioridade): esperando o contador (regime, IE/CSC na SEFAZ-TO, NCM/CFOP/CSOSN/CEST por categoria, certificado A1). Plano: dados fiscais por categoria, com exceção por produto; emissão por uma API (Focus NFe, Nuvem Fiscal…).
- Relatório/exportação mensal para o contador.
- Mostrar o CPF completo só para o admin (LGPD).
- Balança: esperando o modelo.
- Impressora da cozinha: Bematech MP-4200 por Wi-Fi, ainda não testada de verdade (modo ESC/POS, porta 9100).
