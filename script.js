const TOTAL_COMANDAS = 50;
let comandas = {};
let historicoPagos = [];
let comandaSelecionada = null;
let caixaAberto = false;
let fundoCaixa = 0;

// Base de dados com indicação de quais itens vão para a cozinha (requerCozinha: true/false)
const produtosBase = [
    { codigo: "101", nome: "Açaí 500ml", preco: 18.00, requerCozinha: true },
    { codigo: "102", nome: "Açaí 300ml", preco: 13.00, requerCozinha: true },
    { codigo: "201", nome: "Leite Ninho", preco: 3.50, requerCozinha: true },
    { codigo: "202", nome: "Nutella", preco: 5.00, requerCozinha: true },
    { codigo: "301", nome: "Água sem Gás", preco: 4.00, requerCozinha: false },
    { codigo: "302", nome: "Coca-Cola Lata", preco: 6.00, requerCozinha: false }
];

function init() {
    carregarStorage();
    renderizarAtalhosProdutos();
    renderizarTudo();
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
    const val = parseFloat(document.getElementById('input-fundo-caixa').value) || 0;
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
    const subtotal = c.itens.reduce((acc, item) => acc + (item.preco * item.qtd), 0);
    const total = Math.max(0, subtotal - (c.desconto || 0) - (c.adiantamento || 0));
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
        
        // Verifica se há itens de cozinha pendentes de impressão
        const temPendente = comandas[i].itens.some(item => item.requerCozinha && !item.impresso);

        const card = document.createElement('div');
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
                <span class="subtext">Pago às ${item.hora}</span>
            </div>
            <span class="valor-destaque">${formatarMoeda(item.valor)}</span>
        `;
        lista.appendChild(li);
    });
}

function renderizarAtalhosProdutos() {
    const container = document.getElementById('quick-products-bar');
    container.innerHTML = '';
    produtosBase.forEach(prod => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary btn-sm';
        btn.innerText = `+ ${prod.nome}`;
        btn.onclick = () => inserirProdutoDireto(prod);
        container.appendChild(btn);
    });
}

function abrirModalComanda(numero) {
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
                    <strong>${item.nome}</strong>
                    ${item.obs ? `<span class="item-obs">Obs: ${item.obs}</span>` : ''}
                    <button class="btn btn-secondary btn-sm" style="margin-left:5px;" onclick="adicionarObservacao(${index})">📝 Obs</button>
                </td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="alterarQtdItem(${index}, -1)">-</button>
                    ${item.qtd}
                    <button class="btn btn-secondary btn-sm" onclick="alterarQtdItem(${index}, 1)">+</button>
                </td>
                <td>${formatarMoeda(item.preco)}</td>
                <td>${formatarMoeda(item.preco * item.qtd)}</td>
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
    document.getElementById('modal-comanda').classList.remove('active');
    document.getElementById('input-item-modal').value = '';
    comandaSelecionada = null;
}

function inserirProdutoDireto(prod) {
    if (!comandaSelecionada) return;
    comandas[comandaSelecionada].aberta = true;
    
    // Todo item novo que requer cozinha começa como impresso = false
    comandas[comandaSelecionada].itens.push({
        ...prod,
        qtd: 1,
        obs: "",
        impresso: false
    });

    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
}

function adicionarItemPorPesquisa() {
    if (!comandaSelecionada) return;
    const termo = document.getElementById('input-item-modal').value.trim().toLowerCase();
    if (!termo) return;

    const prod = produtosBase.find(p => p.codigo.toLowerCase() === termo || p.nome.toLowerCase().includes(termo));
    if (prod) {
        inserirProdutoDireto(prod);
        document.getElementById('input-item-modal').value = '';
    } else {
        alert('Produto não encontrado!');
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
    if (item) {
        item.qtd += delta;
        if (item.qtd <= 0) comandas[comandaSelecionada].itens.splice(index, 1);
    }
    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
}

function removerItem(index) {
    if (!comandaSelecionada) return;
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

function aplicarDesconto() {
    if (!comandaSelecionada) return;
    const val = prompt("Digite o valor do desconto (R$):");
    const d = parseFloat(val ? val.replace(',', '.') : 0);
    if (!isNaN(d) && d >= 0) {
        comandas[comandaSelecionada].desconto = d;
        renderizarTudo();
        abrirModalComanda(comandaSelecionada);
    }
}

function adiantarValor() {
    if (!comandaSelecionada) return;
    const val = prompt("Digite o valor do adiantamento (R$):");
    const a = parseFloat(val ? val.replace(',', '.') : 0);
    if (!isNaN(a) && a >= 0) {
        comandas[comandaSelecionada].adiantamento += a;
        renderizarTudo();
        abrirModalComanda(comandaSelecionada);
    }
}

function receberComandaAtual() {
    if (!comandaSelecionada) return;
    const fin = calcularFinanceiroComanda(comandaSelecionada);

    if (fin.total === 0 && comandas[comandaSelecionada].itens.length === 0) {
        alert("Comanda vazia!");
        return;
    }

    const valorPagoStr = prompt(`Total a pagar: ${formatarMoeda(fin.total)}\nDigite o valor pago pelo cliente:`);
    if (valorPagoStr === null) return;

    const valorPago = parseFloat(valorPagoStr.replace(',', '.')) || fin.total;

    if (valorPago < fin.total) {
        alert("Valor pago insuficiente!");
        return;
    }

    const troco = valorPago - fin.total;
    alert(`Pagamento realizado com sucesso!\nTroco: ${formatarMoeda(troco)}`);

    const agora = new Date();
    const horaStr = agora.getHours().toString().padStart(2, '0') + ':' + agora.getMinutes().toString().padStart(2, '0');

    historicoPagos.unshift({ numero: comandaSelecionada, valor: fin.total, hora: horaStr });
    comandas[comandaSelecionada] = { aberta: false, itens: [], adiantamento: 0, desconto: 0 };

    fecharModal();
    renderizarTudo();
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
    document.querySelectorAll('.navbar-menu a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

    document.getElementById(`nav-${aba}`).classList.add('active');
    document.getElementById(`view-${aba}`).classList.add('active');
}

function trocarTelaDirect(aba) {
    solicitarAberturaCaixa();
    trocarAba(aba);
}

init();