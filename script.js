const TOTAL_COMANDAS = 50;
let comandas = {};
let historicoPagos = [];
let comandaSelecionada = null;
let caixaAberto = false;
let fundoCaixa = 0;

let produtosBase = [];
let produtosConectados = false;

function init() {
    carregarStorage();
    renderizarAtalhosProdutos();
    renderizarTudo();
    carregarProdutos();
}

function carregarStorage() {
    const comandasSalvas = localStorage.getItem('acai_comandas');
    const historicoSalvo = localStorage.getItem('acai_historico');
    const caixaSalvo = localStorage.getItem('acai_caixa');

    if (comandasSalvas) {
        comandas = JSON.parse(comandasSalvas);
    } else {
        for (let i = 1; i <= TOTAL_COMANDAS; i++) {
            comandas[i] = { aberta: false, itens: [], adiantamento: 0, desconto: 0 };
        }
    }

    if (historicoSalvo) historicoPagos = JSON.parse(historicoSalvo);
    if (caixaSalvo) {
        const cData = JSON.parse(caixaSalvo);
        caixaAberto = cData.aberto;
        fundoCaixa = cData.fundo;
        atualizarBadgeCaixa();
    }
}

function salvarStorage() {
    localStorage.setItem('acai_comandas', JSON.stringify(comandas));
    localStorage.setItem('acai_historico', JSON.stringify(historicoPagos));
    localStorage.setItem('acai_caixa', JSON.stringify({ aberto: caixaAberto, fundo: fundoCaixa }));
}

function atualizarBadgeCaixa() {
    const badge = document.getElementById('status-caixa-badge');
    if (caixaAberto) {
        badge.innerText = `Caixa Aberto (${formatarMoeda(fundoCaixa)})`;
        badge.classList.add('open');
    } else {
        badge.innerText = `Caixa Fechado`;
        badge.classList.remove('open');
    }
}

// LÓGICA DE ABERTURA DE CAIXA
function solicitarAberturaCaixa() {
    if (!caixaAberto) {
        document.getElementById('modal-abertura-caixa').classList.add('active');
    } else {
        entrarNoPDV();
    }
}

function confirmarAberturaCaixa() {
    const val = Number(document.getElementById('input-fundo-caixa').value);
    if (!Number.isFinite(val) || val < 0) return avisar('Informe um fundo de caixa válido.');
    fundoCaixa = val;
    caixaAberto = true;
    atualizarBadgeCaixa();
    salvarStorage();
    document.getElementById('modal-abertura-caixa').classList.remove('active');
    entrarNoPDV();
}

function entrarNoPDV() {
    document.getElementById('screen-landing').classList.remove('active');
    document.getElementById('screen-app').classList.add('active');
    trocarAba('pdv');
}

function voltarTelaInicial() {
    document.getElementById('screen-app').classList.remove('active');
    document.getElementById('screen-landing').classList.add('active');
}

function calcularFinanceiroComanda(num) {
    const c = comandas[num];
    if (!c || !c.itens) return { subtotal: 0, desconto: 0, adiantamento: 0, total: 0 };
    const subtotal = c.itens.reduce((acc, item) => acc + totalItemCentavos(item), 0) / 100;
    const total = Math.max(0, centavos(subtotal) - centavos(c.desconto || 0) - centavos(c.adiantamento || 0)) / 100;
    return { subtotal, desconto: c.desconto || 0, adiantamento: c.adiantamento || 0, total };
}

function formatarMoeda(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

function renderizarTudo() {
    renderizarGrid();
    renderizarAbertas();
    renderizarPagas();
    salvarStorage();
}

function renderizarGrid() {
    const container = document.getElementById('comandas-grid');
    container.innerHTML = '';

    for (let i = 1; i <= TOTAL_COMANDAS; i++) {
        const fin = calcularFinanceiroComanda(i);
        const estaAberta = comandas[i].aberta;
        const filtro = document.getElementById('filtro-comandas').value;
        if ((filtro === 'abertas' && !estaAberta) || (filtro === 'livres' && estaAberta)) continue;
        
        // Verifica se há itens de cozinha pendentes de impressão
        const temPendente = comandas[i].itens.some(item => item.requerCozinha && !item.impresso);

        const card = document.createElement('button');
        card.type = 'button';
        card.setAttribute('aria-label', `Comanda ${i}, ${estaAberta ? formatarMoeda(fin.total) : 'livre'}`);
        card.className = `comanda-card ${estaAberta ? 'comanda-ocupada' : 'comanda-livre'} ${temPendente ? 'has-pending' : ''}`;
        card.onclick = () => abrirModalComanda(i);
        card.innerHTML = `
            <span class="numero">${i.toString().padStart(2, '0')}</span>
            <span class="valor">${estaAberta ? formatarMoeda(fin.total) : 'Livre'}</span>
        `;
        container.appendChild(card);
    }
}

function renderizarAbertas() {
    const lista = document.getElementById('lista-abertas');
    lista.innerHTML = '';

    for (let i = 1; i <= TOTAL_COMANDAS; i++) {
        if (comandas[i].aberta) {
            const fin = calcularFinanceiroComanda(i);
            const qtdItens = comandas[i].itens.reduce((a, b) => a + b.qtd, 0);

            const li = document.createElement('li');
            li.className = 'item-card aberto';
            li.onclick = () => abrirModalComanda(i);
            li.innerHTML = `
                <div class="info-comanda">
                    <span class="titulo">Comanda #${i.toString().padStart(2, '0')}</span>
                    <span class="subtext">${qtdItens} item(ns)</span>
                </div>
                <span class="valor-destaque">${formatarMoeda(fin.total)}</span>
            `;
            lista.appendChild(li);
        }
    }
}

function renderizarPagas() {
    const lista = document.getElementById('lista-pagas');
    lista.innerHTML = '';
    historicoPagos.slice(0, 5).forEach(item => {
        const li = document.createElement('li');
        li.className = 'item-card pago';
        li.innerHTML = `
            <div class="info-comanda">
                <span class="titulo">Comanda #${item.numero.toString().padStart(2, '0')}</span>
                <span class="subtext">${item.valorCrediario > 0 || item.status === 'A receber' ? 'Crediário' : 'Pago'} às ${escaparHtml(item.hora)}</span>
            </div>
            <span class="valor-destaque">${formatarMoeda(item.valor)}</span>
        `;
        lista.appendChild(li);
    });
}

function renderizarAtalhosProdutos() {
    const container = document.getElementById('quick-products-bar');
    container.innerHTML = '';
    produtosBase.filter(prod => prod.ativo).slice(0, 8).forEach(prod => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary btn-sm';
        btn.innerText = `+ ${prod.nome}${prod.unidade === 'KG' ? ' / kg' : ''}`;
        btn.onclick = () => inserirProdutoDireto(prod);
        container.appendChild(btn);
    });
}

function abrirModalComanda(numero) {
    if (comandaSelecionada !== numero) limparBuscaComanda();
    comandaSelecionada = numero;
    const c = comandas[numero];

    document.getElementById('modal-titulo').innerText = `Comanda #${numero.toString().padStart(2, '0')}`;
    
    const tbody = document.getElementById('modal-tabela-itens');
    tbody.innerHTML = '';

    if (c.itens.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#999;">Nenhum item adicionado</td></tr>`;
    } else {
        c.itens.forEach((item, index) => {
            let statusCozinhaHtml = '<span class="status-badge badge-no-kitchen">N/A</span>';
            if (item.requerCozinha) {
                statusCozinhaHtml = item.impresso 
                    ? '<span class="status-badge badge-printed">Impresso</span>'
                    : '<span class="status-badge badge-pending">Pendente</span>';
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <strong>${escaparHtml(item.nome)}</strong>
                    ${item.obs ? `<span class="item-obs">Obs: ${escaparHtml(item.obs)}</span>` : ''}
                    <button class="btn btn-secondary btn-sm" style="margin-left:5px;" onclick="adicionarObservacao(${index})">📝 Obs</button>
                </td>
                <td>
                    <input class="item-quantity" aria-label="Quantidade de ${escaparHtml(item.nome)}" type="number" min="${item.unidade === 'KG' ? '0.001' : '1'}" step="${item.unidade === 'KG' ? '0.001' : '1'}" value="${item.qtd}" onchange="definirQuantidadeItem(${index}, this.value)"><small>${item.unidade || 'UN'}</small>
                </td>
                <td>${formatarMoeda(item.preco)}<small> / ${(item.unidade || 'UN').toLowerCase()}</small></td>
                <td>${formatarMoeda(totalItemCentavos(item) / 100)}</td>
                <td style="text-align:center;">${statusCozinhaHtml}</td>
                <td><button class="btn btn-danger btn-sm" onclick="removerItem(${index})">&times;</button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    const fin = calcularFinanceiroComanda(numero);
    document.getElementById('summary-subtotal').innerText = formatarMoeda(fin.subtotal);
    document.getElementById('summary-desconto').innerText = formatarMoeda(fin.desconto);
    document.getElementById('summary-adiantamento').innerText = formatarMoeda(fin.adiantamento);
    document.getElementById('summary-total').innerText = formatarMoeda(fin.total);

    document.getElementById('modal-comanda').classList.add('active');
}

function fecharModal() {
    fecharJanela('modal-pagamento');
    fecharJanela('modal-transferencia');
    document.getElementById('modal-comanda').classList.remove('active');
    limparBuscaComanda();
    comandaSelecionada = null;
}

function inserirProdutoDireto(prod) {
    if (!comandaSelecionada || !prod.ativo) return;
    comandas[comandaSelecionada].aberta = true;
    
    // Todo item novo que requer cozinha começa como impresso = false
    comandas[comandaSelecionada].itens.push({
        ...prod,
        qtd: prod.unidade === 'KG' ? 0.100 : 1,
        obs: "",
        impresso: false
    });

    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
}

function normalizarBusca(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}
function encontrarProdutos(termo) {
    const busca = normalizarBusca(termo);
    if (!busca) return [];
    return produtosBase.filter(p => p.ativo && [p.codigo,p.codigoBarras,p.nome].some(v => normalizarBusca(v).includes(busca))).sort((a,b) => {
        const exato = p => [p.codigo,p.codigoBarras,p.nome].some(v => normalizarBusca(v) === busca);
        return Number(exato(b)) - Number(exato(a)) || a.nome.localeCompare(b.nome,'pt-BR');
    });
}
function limparBuscaComanda() {
    document.getElementById('input-item-modal').value = '';
    document.getElementById('busca-produtos-resultados').replaceChildren();
    document.getElementById('busca-produtos-resultados').hidden = true;
    document.getElementById('busca-produtos-status').hidden = true;
}
function selecionarProdutoBusca(produto) {
    inserirProdutoDireto(produto);
    limparBuscaComanda();
    document.getElementById('input-item-modal').focus();
}
function pesquisarProdutosComanda() {
    const termo = document.getElementById('input-item-modal').value;
    const container = document.getElementById('busca-produtos-resultados');
    const status = document.getElementById('busca-produtos-status');
    container.replaceChildren();
    if (!normalizarBusca(termo)) { container.hidden = true; status.hidden = true; return; }
    const encontrados = encontrarProdutos(termo);
    container.hidden = encontrados.length === 0;
    status.hidden = false;
    status.textContent = !produtosConectados ? 'Conecte ao servidor local para pesquisar os produtos.' : encontrados.length ? encontrados.length + ' produto(s) encontrado(s). Selecione o produto para adicionar.' : 'Nenhum produto disponível encontrado para esta busca.';
    encontrados.forEach(prod => {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'search-result';
        const nome = document.createElement('strong'); nome.textContent = prod.nome;
        const codigo = document.createElement('span'); codigo.textContent = 'Código ' + prod.codigo;
        const preco = document.createElement('span'); preco.textContent = formatarMoeda(prod.preco) + ' / ' + prod.unidade.toLowerCase();
        btn.append(nome,codigo,preco); btn.onclick = () => selecionarProdutoBusca(prod); container.append(btn);
    });
}
function adicionarItemPorPesquisa() {
    if (!comandaSelecionada) return;
    const termo = normalizarBusca(document.getElementById('input-item-modal').value);
    if (!termo) return;
    const encontrados = encontrarProdutos(termo);
    const exatos = encontrados.filter(p => [p.codigo,p.codigoBarras,p.nome].some(v => normalizarBusca(v) === termo));
    if (exatos.length === 1) selecionarProdutoBusca(exatos[0]);
    else if (encontrados.length === 1) selecionarProdutoBusca(encontrados[0]);
    else {
        pesquisarProdutosComanda();
        if (encontrados.length > 1) document.getElementById('busca-produtos-status').textContent = 'Há mais de um produto. Selecione na lista qual deseja adicionar.';
    }
}

function adicionarObservacao(index) {
    if (!comandaSelecionada) return;
    const item = comandas[comandaSelecionada].itens[index];
    const obs = prompt(`Digite a observação para "${item.nome}":`, item.obs || "");
    if (obs !== null) {
        item.obs = obs.trim();
        renderizarTudo();
        abrirModalComanda(comandaSelecionada);
    }
}

function alterarQtdItem(index, delta) {
    if (!comandaSelecionada) return;
    const item = comandas[comandaSelecionada].itens[index];
    if (item && delta < 0 && !podeReduzirSaldo(item.preco)) return;
    if (item) {
        item.qtd += delta;
        if (item.qtd <= 0) comandas[comandaSelecionada].itens.splice(index, 1);
    }
    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
}

function removerItem(index) {
    if (!comandaSelecionada) return;
    const item = comandas[comandaSelecionada].itens[index];
    if (!item || !podeReduzirSaldo(item.preco * item.qtd)) return;
    comandas[comandaSelecionada].itens.splice(index, 1);
    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
}

function imprimirCozinha() {
    if (!comandaSelecionada) return;
    const c = comandas[comandaSelecionada];
    const pendentes = c.itens.filter(i => i.requerCozinha && !i.impresso);

    if (pendentes.length === 0) {
        alert("Não há itens pendentes para enviar à cozinha!");
        return;
    }

    let ticket = `*** COZINHA - COMANDA #${comandaSelecionada} ***\n\n`;
    pendentes.forEach(i => {
        ticket += `${i.qtd}x ${i.nome}\n`;
        if (i.obs) ticket += `   Obs: ${i.obs}\n`;
    });

    alert(`[IMPRESSORA TÉRMICA]\n\n${ticket}`);

    // Marca como impressos
    pendentes.forEach(i => i.impresso = true);
    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
}

function adiantarValor() {
    if (!comandaSelecionada) return;
    const val = prompt("Digite o valor do adiantamento (R$):");
    const a = parseFloat(val ? val.replace(',', '.') : 0);
    if (Number.isFinite(a) && a >= 0 && centavos(a) <= centavos(calcularFinanceiroComanda(comandaSelecionada).total)) {
        comandas[comandaSelecionada].adiantamento += a;
        renderizarTudo();
        abrirModalComanda(comandaSelecionada);
    } else if (val !== null) avisar('Informe um adiantamento entre zero e o saldo a pagar.');
}

function abrirNovaComandaRapida() {
    const num = prompt("Número da comanda (1 a 50):");
    const n = parseInt(num);
    if (n >= 1 && n <= TOTAL_COMANDAS) {
        comandas[n].aberta = true;
        renderizarTudo();
        abrirModalComanda(n);
    }
}

function trocarAba(aba) {
    if (aba === 'historico') renderizarHistorico();
    document.querySelectorAll('.navbar-menu a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

    document.getElementById(`nav-${aba}`).classList.add('active');
    document.getElementById(`view-${aba}`).classList.add('active');
}

function trocarTelaDirect(aba) {
    document.getElementById('screen-landing').classList.remove('active');
    document.getElementById('screen-app').classList.add('active');
    trocarAba(aba);
}

function escaparHtml(texto) {
    return String(texto).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

function centavos(valor) { return Math.round((valor + Number.EPSILON) * 100); }
function fecharJanela(id) {
    document.getElementById(id).classList.remove('active');
    document.getElementById('modal-comanda').inert = false;
    if (comandaSelecionada) document.querySelector('#modal-comanda .btn-pay').focus();
}
let toastTimer;
function avisar(texto) {
    const toast = document.getElementById('toast');
    toast.textContent = texto;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function receberComandaAtual() {
    if (!comandaSelecionada) return;
    const c = comandas[comandaSelecionada];
    if (!c.itens.length) return avisar('Adicione itens antes de efetuar o pagamento.');
    const fin = calcularFinanceiroComanda(comandaSelecionada);
    document.getElementById('titulo-pagamento').textContent = `Pagamento · Comanda ${comandaSelecionada}`;
    document.getElementById('pag-tipo-desconto').value = 'valor';
    document.getElementById('pag-desconto').value = fin.desconto ? fin.desconto.toFixed(2) : '';
    document.querySelectorAll('.payment-card input').forEach(input => { input.value = ''; });
    document.getElementById('pag-cliente').value = '';
    atualizarPagamento();
    document.getElementById('modal-comanda').inert = true;
    document.getElementById('modal-pagamento').classList.add('active');
    document.getElementById('pag-desconto').focus();
}

function dadosPagamento() {
    const fin = calcularFinanceiroComanda(comandaSelecionada);
    const entrada = Number(document.getElementById('pag-desconto').value);
    const percentual = document.getElementById('pag-tipo-desconto').value === 'percentual';
    const desconto = percentual ? centavos(fin.subtotal * entrada / 100) : centavos(entrada);
    const disponivel = centavos(fin.subtotal) - centavos(fin.adiantamento);
    let erro = '';
    if (!Number.isFinite(entrada) || entrada < 0 || (percentual && entrada > 100) || desconto > disponivel) erro = 'O desconto deve estar entre zero e o saldo disponível.';
    return { fin, desconto, total: Math.max(0, disponivel - desconto), erro };
}

function valoresPagamento() {
    const dados = dadosPagamento();
    const entradas = [...document.querySelectorAll('.payment-card input')].map(input => ({metodo: input.dataset.metodo, valor: Number(input.value)}));
    let erro = dados.erro;
    if (entradas.some(p => !Number.isFinite(p.valor) || p.valor < 0)) erro = 'Informe valores válidos, iguais ou maiores que zero.';
    const pagamentos = entradas.filter(p => p.valor > 0).map(p => ({metodo:p.metodo, valor:centavos(p.valor)}));
    const informado = pagamentos.reduce((s,p) => s + p.valor, 0);
    const dinheiro = pagamentos.find(p => p.metodo === 'Dinheiro')?.valor || 0;
    const troco = Math.max(0, informado - dados.total);
    if (!erro && troco > dinheiro) erro = 'Os valores das outras formas excedem o total. Ajuste os valores; o troco só pode sair do dinheiro.';
    return {...dados, pagamentos, informado, dinheiro, troco, erro};
}

function atualizarPagamento() {
    if (!comandaSelecionada) return;
    const dados = valoresPagamento();
    document.getElementById('pag-subtotal').textContent = formatarMoeda(dados.fin.subtotal);
    document.getElementById('pag-adiantamento').textContent = formatarMoeda(dados.fin.adiantamento);
    document.getElementById('pag-total').textContent = formatarMoeda(dados.total / 100);
    document.getElementById('pag-informado').textContent = formatarMoeda(dados.informado / 100);
    document.getElementById('pag-restante').textContent = formatarMoeda(Math.max(0, dados.total - dados.informado) / 100);
    document.getElementById('pag-troco').textContent = formatarMoeda(dados.troco / 100);
    document.getElementById('pag-erro').textContent = dados.erro;
    const crediario = dados.pagamentos.some(p => p.metodo === 'Crediário');
    document.getElementById('pag-cliente-box').hidden = !crediario;
    document.getElementById('pag-cliente').required = crediario;
    document.querySelectorAll('.payment-card').forEach(card => card.classList.toggle('filled', Number(card.querySelector('input').value) > 0));
}

function confirmarPagamento() {
    if (!comandaSelecionada || !caixaAberto) return;
    const dados = valoresPagamento();
    const cliente = document.getElementById('pag-cliente').value.trim();
    const crediario = dados.pagamentos.find(p => p.metodo === 'Crediário')?.valor || 0;
    let erro = dados.erro;
    if (!erro && dados.informado < dados.total) erro = 'Valor insuficiente. Complete o saldo nas formas de pagamento.';
    if (!erro && crediario && !cliente) erro = 'Informe o cliente do crediário.';
    if (erro) { document.getElementById('pag-erro').textContent = erro; return; }
    const pagamentos = dados.pagamentos.map(p => ({metodo:p.metodo, valor:(p.valor - (p.metodo === 'Dinheiro' ? dados.troco : 0)) / 100})).filter(p => p.valor > 0);
    const numero = comandaSelecionada;
    historicoPagos.unshift({
        numero, valor: dados.total / 100, hora: new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}),
        data: new Date().toISOString(), subtotal: dados.fin.subtotal, desconto: dados.desconto / 100,
        adiantamento: dados.fin.adiantamento, pagamentos,
        metodo: pagamentos.map(p => p.metodo).join(' + ') || 'Saldo quitado', cliente: crediario ? cliente : '',
        status: crediario ? (crediario === dados.total ? 'A receber' : 'Parcial a receber') : 'Pago',
        valorCrediario: crediario / 100, recebido: dados.informado / 100,
        troco: dados.troco / 100, itens: comandas[numero].itens.map(item => ({...item}))
    });
    comandas[numero] = {aberta:false, itens:[], adiantamento:0, desconto:0};
    fecharModal();
    renderizarTudo();
    avisar(crediario ? 'Venda registrada com saldo no crediário.' : 'Pagamento registrado. Troco: ' + formatarMoeda(dados.troco / 100));
}

function abrirTransferencia() {
    if (!comandaSelecionada || !comandas[comandaSelecionada].itens.length) return avisar('Não há itens para transferir.');
    const container = document.getElementById('transferencia-itens');
    container.replaceChildren();
    comandas[comandaSelecionada].itens.forEach((item, index) => {
        const label = document.createElement('label');
        label.className = 'transfer-row';
        const texto = document.createElement('span');
        texto.textContent = `${item.nome} · ${item.qtd} disponível(is)`;
        const input = document.createElement('input');
        input.type = 'number'; input.min = 0; input.max = item.qtd; input.step = item.unidade === 'KG' ? '0.001' : '1'; input.value = 0;
        input.dataset.index = index; input.setAttribute('aria-label', `Quantidade de ${item.nome} para transferir`);
        label.append(texto, input); container.append(label);
    });
    const destino = document.getElementById('transferencia-destino');
    destino.replaceChildren();
    for (let n = 1; n <= TOTAL_COMANDAS; n++) {
        if (n === comandaSelecionada) continue;
        const option = document.createElement('option');
        option.value = n; option.textContent = `Comanda ${n} · ${comandas[n].aberta ? 'Em consumo' : 'Livre'}`;
        destino.append(option);
    }
    document.getElementById('transferencia-erro').textContent = '';
    document.getElementById('modal-comanda').inert = true;
    document.getElementById('modal-transferencia').classList.add('active');
    container.querySelector('input').focus();
}

function confirmarTransferencia() {
    if (!comandaSelecionada) return;
    const origem = comandas[comandaSelecionada];
    const numeroDestino = Number(document.getElementById('transferencia-destino').value);
    const destino = comandas[numeroDestino];
    const quantidades = Array.from(document.querySelectorAll('#transferencia-itens input'), input => Number(input.value));
    let erro = '';
    if (!destino || numeroDestino === comandaSelecionada) erro = 'Escolha uma comanda de destino válida.';
    if (quantidades.length !== origem.itens.length || quantidades.some((q, i) => !Number.isFinite(q) || q < 0 || q > origem.itens[i].qtd || (origem.itens[i].unidade === 'KG' ? Math.abs(q * 1000 - Math.round(q * 1000)) > 0.000001 : !Number.isInteger(q)))) erro = 'Confira as quantidades dos itens.';
    if (!quantidades.some(q => q > 0)) erro = 'Selecione ao menos um item para transferir.';
    const saldoRestante = origem.itens.reduce((s, item, i) => s + totalItemCentavos({...item, qtd: Math.round((item.qtd - quantidades[i]) * 1000) / 1000}), 0);
    if (!erro && saldoRestante < centavos(origem.desconto || 0) + centavos(origem.adiantamento || 0)) erro = 'Mantenha itens suficientes na origem para cobrir o desconto e o adiantamento.';
    if (erro) { document.getElementById('transferencia-erro').textContent = erro; return; }
    origem.itens.forEach((item, i) => {
        if (quantidades[i]) destino.itens.push({...item, qtd:quantidades[i]});
        item.qtd = Math.round((item.qtd - quantidades[i]) * 1000) / 1000;
    });
    origem.itens = origem.itens.filter(item => item.qtd > 0);
    origem.aberta = origem.itens.length > 0;
    destino.aberta = true;
    fecharJanela('modal-transferencia');
    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
    avisar(`Itens transferidos para a comanda ${numeroDestino}.`);
}

function renderizarHistorico() {
    const box = document.getElementById('historico-list');
    if (!historicoPagos.length) { box.textContent = 'Nenhuma venda registrada.'; return; }
    box.innerHTML = '<div class="table-scroll"><table class="table-items"><thead><tr><th>Comanda</th><th>Data / hora</th><th>Pagamento</th><th>Desconto</th><th>Valor</th><th>Status</th></tr></thead><tbody>' + historicoPagos.map(v => `<tr><td>#${v.numero}</td><td>${v.data ? new Date(v.data).toLocaleDateString('pt-BR') : ''} ${escaparHtml(v.hora)}</td><td>${(v.pagamentos ? v.pagamentos.map(p => escaparHtml(p.metodo) + ': ' + formatarMoeda(p.valor)).join('<br>') : escaparHtml(v.metodo || 'Não informado'))}${v.cliente ? '<br>' + escaparHtml(v.cliente) : ''}</td><td>${formatarMoeda(v.desconto || 0)}</td><td>${formatarMoeda(v.valor)}</td><td>${escaparHtml(v.status || 'Pago')}</td></tr>`).join('') + '</tbody></table></div>';
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        const janela = ['modal-transferencia', 'modal-pagamento'].find(id => document.getElementById(id).classList.contains('active'));
        if (janela) fecharJanela(janela); else if (comandaSelecionada) fecharModal();
    }
    if (event.key === 'Enter' && event.target.id === 'input-item-modal') adicionarItemPorPesquisa();
});

init();


function podeReduzirSaldo(valor) {
    const f = calcularFinanceiroComanda(comandaSelecionada);
    if (centavos(f.subtotal) - centavos(valor) < centavos(f.desconto) + centavos(f.adiantamento)) {
        avisar('Este item cobre desconto ou adiantamento da comanda. Confira esses valores antes de removê-lo.');
        return false;
    }
    return true;
}

document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const modais = [...document.querySelectorAll('.modal-overlay.active')];
    const modal = modais[modais.length - 1];
    if (!modal) return;
    const controles = [...modal.querySelectorAll('button, input, select, [tabindex]')].filter(el => !el.disabled && el.getClientRects().length);
    const primeiro = controles[0], ultimo = controles[controles.length - 1];
    if (event.shiftKey && document.activeElement === primeiro) { event.preventDefault(); ultimo.focus(); }
    if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primeiro.focus(); }
});

function totalItemCentavos(item) { return Math.round(centavos(item.preco) * Math.round(item.qtd * 1000) / 1000); }
function definirQuantidadeItem(index, valor) {
    if (!comandaSelecionada) return;
    const item = comandas[comandaSelecionada].itens[index];
    const qtd = Number(valor);
    if (!Number.isFinite(qtd) || qtd <= 0 || qtd > 999999 || (item.unidade === 'KG' ? Math.abs(qtd * 1000 - Math.round(qtd * 1000)) > 0.000001 : !Number.isInteger(qtd))) {
        avisar('Informe uma quantidade válida. Para kg, use até três casas decimais.');
        abrirModalComanda(comandaSelecionada); return;
    }
    if (qtd < item.qtd && !podeReduzirSaldo((totalItemCentavos(item) - totalItemCentavos({...item, qtd})) / 100)) { abrirModalComanda(comandaSelecionada); return; }
    item.qtd = qtd; renderizarTudo(); abrirModalComanda(comandaSelecionada);
}
async function carregarProdutos() {
    document.getElementById('produtos-conexao').textContent = 'Conectando ao banco local…';
    try {
        if (location.protocol === 'file:') throw new Error('Abra o sistema pelo endereço http://localhost:3000 após iniciar o servidor.');
        const response = await fetch('/api/produtos');
        if (!response.ok) throw new Error('Não foi possível carregar os produtos. Verifique se o servidor está ligado.');
        produtosBase = await response.json(); produtosConectados = true;
        document.getElementById('produtos-conexao').textContent = 'Produtos salvos no banco local deste computador.';
        document.getElementById('produtos-reconectar').hidden = true;
    } catch (e) {
        produtosBase = []; produtosConectados = false;
        document.getElementById('produtos-conexao').textContent = e.message;
        document.getElementById('produtos-reconectar').hidden = false;
    }
    document.getElementById('produto-salvar').disabled = !produtosConectados;
    renderizarProdutos(); renderizarAtalhosProdutos();
    if (comandaSelecionada) pesquisarProdutosComanda();
}
function renderizarProdutos() {
    const termo = document.getElementById('produto-busca').value.trim().toLowerCase();
    const produtos = produtosBase.filter(p => [p.nome,p.codigo,p.codigoBarras].some(v => v.toLowerCase().includes(termo)));
    const tbody = document.getElementById('produtos-lista'); tbody.replaceChildren();
    if (!produtos.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 5; td.textContent = produtosConectados ? 'Nenhum produto encontrado.' : 'Conecte ao servidor para consultar os produtos.'; tr.append(td); tbody.append(tr); }
    produtos.forEach(p => {
        const tr = document.createElement('tr');
        for (const texto of [p.codigo,p.nome,formatarMoeda(p.preco) + ' / ' + p.unidade.toLowerCase(),p.ativo ? 'Ativo' : 'Inativo']) { const td = document.createElement('td'); td.textContent = texto; tr.append(td); }
        const td = document.createElement('td'); const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-secondary btn-sm'; btn.textContent = 'Editar'; btn.setAttribute('aria-label','Editar ' + p.nome); btn.onclick = () => editarProduto(p.id); td.append(btn); tr.append(td); tbody.append(tr);
    });
}
function atualizarRotuloPreco() { document.getElementById('produto-preco-label').textContent = document.getElementById('produto-unidade').value === 'KG' ? 'Preço por kg (R$) *' : 'Preço por unidade (R$) *'; }
function novoProduto() {
    document.getElementById('produto-form').reset();
    document.getElementById('produto-id').value = '';
    document.getElementById('produto-form-titulo').textContent = 'Novo produto';
    document.getElementById('produto-erro').textContent = ''; atualizarRotuloPreco();
    document.getElementById('produto-nome').focus();
}
function editarProduto(id) {
    const p = produtosBase.find(p => p.id === id); if (!p) return;
    document.getElementById('produto-id').value = p.id;
    for (const [campo,valor] of Object.entries({nome:p.nome,codigo:p.codigo,preco:p.preco.toFixed(2),unidade:p.unidade,categoria:p.categoria,barras:p.codigoBarras})) document.getElementById('produto-' + campo).value = valor;
    document.getElementById('produto-cozinha').checked = p.requerCozinha;
    document.getElementById('produto-ativo').checked = p.ativo;
    document.getElementById('produto-form-titulo').textContent = 'Editar produto';
    document.getElementById('produto-erro').textContent = ''; atualizarRotuloPreco();
    document.getElementById('produto-nome').focus();
}
async function salvarProduto() {
    if (!produtosConectados) return;
    const botao = document.getElementById('produto-salvar'); botao.disabled = true;
    document.getElementById('produto-erro').textContent = '';
    const id = document.getElementById('produto-id').value;
    const dados = {codigo:document.getElementById('produto-codigo').value.trim(),nome:document.getElementById('produto-nome').value.trim(),preco:Number(document.getElementById('produto-preco').value),unidade:document.getElementById('produto-unidade').value,categoria:document.getElementById('produto-categoria').value.trim(),codigoBarras:document.getElementById('produto-barras').value.trim(),requerCozinha:document.getElementById('produto-cozinha').checked,ativo:document.getElementById('produto-ativo').checked};
    try {
        const response = await fetch('/api/produtos' + (id ? '/' + id : ''), {method:id ? 'PUT' : 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dados)});
        const result = await response.json(); if (!response.ok) throw new Error(result.erro || 'Não foi possível salvar o produto.');
        const index = produtosBase.findIndex(p => p.id === result.id);
        if (index < 0) produtosBase.push(result); else produtosBase[index] = result;
        produtosBase.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));
        renderizarProdutos(); renderizarAtalhosProdutos(); novoProduto(); avisar('Produto salvo no banco local.');
    } catch(e) { document.getElementById('produto-erro').textContent = e instanceof TypeError ? 'Sem conexão com o servidor. Seu formulário foi mantido; tente salvar novamente.' : e.message; }
    finally { botao.disabled = !produtosConectados; }
}
