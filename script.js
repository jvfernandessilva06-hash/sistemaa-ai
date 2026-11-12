const TOTAL_COMANDAS = 50;
let comandas = {};
let comandasCarregadas = false;
let ultimoSalvo = {};
let filaSalvar = Promise.resolve();
let historicoPagos = [];
let comandaSelecionada = null;
let caixaAtual = null;
let usuario = null;

let produtosBase = [];
let produtosConectados = false;
let usuariosBase = [];
let relatorioAtual = null;

for (let i = 1; i <= TOTAL_COMANDAS; i++) comandas[i] = comandaVazia();

// ---------- COMUNICAÇÃO COM O SERVIDOR ----------
async function api(rota, opcoes = {}) {
    let resposta;
    try {
        resposta = await fetch(rota, {
            method: opcoes.method || 'GET',
            headers: opcoes.body === undefined ? {} : {'Content-Type': 'application/json'},
            body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body)
        });
    } catch {
        throw new Error('Sem conexão com o servidor. Verifique se a janela do sistema (iniciar.bat) está aberta.');
    }
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 401 && usuario && rota !== '/api/login') {
        usuario = null;
        mostrarLogin('Sua sessão expirou. Entre novamente.');
    }
    if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível concluir a operação.');
    return dados;
}

function ehAdmin() { return usuario?.perfil === 'admin'; }
function hojeISO(data = new Date()) {
    const z = n => String(n).padStart(2, '0');
    return `${data.getFullYear()}-${z(data.getMonth() + 1)}-${z(data.getDate())}`;
}
function formatarDataHora(texto) {
    if (!texto) return '';
    const [data, hora = ''] = texto.split(' ');
    return data.split('-').reverse().join('/') + ' ' + hora.slice(0, 5);
}

// ---------- LOGIN ----------
async function init() {
    if (location.protocol === 'file:') return mostrarLogin('Abra o sistema pelo endereço http://localhost:3000 depois de iniciar o servidor (iniciar.bat).');
    try {
        const me = await api('/api/me');
        if (me.configurar) mostrarConfiguracao();
        else if (me.usuario) await entrar(me.usuario);
        else mostrarLogin();
    } catch (e) { mostrarLogin(e.message); }
}

function mostrarTela(id) {
    document.querySelectorAll('.screen').forEach(tela => tela.classList.toggle('active', tela.id === id));
}

function mostrarLogin(mensagem = '') {
    document.querySelectorAll('.modal-overlay.active').forEach(modal => modal.classList.remove('active'));
    document.getElementById('modal-comanda').inert = false;
    comandaSelecionada = null;
    document.getElementById('form-login').hidden = false;
    document.getElementById('form-configuracao').hidden = true;
    document.getElementById('login-erro').textContent = mensagem;
    mostrarTela('screen-login');
    document.getElementById('login-usuario').focus();
}

function mostrarConfiguracao() {
    document.getElementById('form-login').hidden = true;
    document.getElementById('form-configuracao').hidden = false;
    mostrarTela('screen-login');
    document.getElementById('config-nome').focus();
}

async function fazerLogin() {
    const erro = document.getElementById('login-erro');
    erro.textContent = '';
    try {
        const r = await api('/api/login', {method: 'POST', body: {login: document.getElementById('login-usuario').value, senha: document.getElementById('login-senha').value}});
        document.getElementById('login-senha').value = '';
        await entrar(r.usuario);
    } catch (e) { erro.textContent = e.message; }
}

async function criarAdministrador() {
    const erro = document.getElementById('config-erro');
    erro.textContent = '';
    const senha = document.getElementById('config-senha').value;
    if (senha !== document.getElementById('config-senha2').value) { erro.textContent = 'As senhas não conferem.'; return; }
    try {
        const r = await api('/api/setup', {method: 'POST', body: {nome: document.getElementById('config-nome').value, login: document.getElementById('config-login').value, senha}});
        await entrar(r.usuario);
    } catch (e) { erro.textContent = e.message; }
}

async function sair() {
    await filaSalvar;
    try { await api('/api/logout', {method: 'POST', body: {}}); } catch {}
    usuario = null;
    mostrarLogin();
}

async function entrar(u) {
    usuario = u;
    document.body.dataset.perfil = u.perfil;
    document.getElementById('usuario-nome').textContent = `${u.nome} · ${u.perfil === 'admin' ? 'Administrador' : 'Atendente'}`;
    mostrarTela('screen-app');
    trocarAba('pdv');
    await Promise.all([carregarProdutos(), carregarComandas(), carregarCaixa(), carregarVendas()]);
    if (usuario && !caixaAtual) solicitarAberturaCaixa();
}

// ---------- CAIXA ----------
async function carregarCaixa() {
    try { caixaAtual = (await api('/api/caixa')).caixa; } catch (e) { avisar(e.message); }
    atualizarBadgeCaixa();
}

function atualizarBadgeCaixa() {
    const badge = document.getElementById('status-caixa-badge');
    badge.innerText = caixaAtual ? `Caixa aberto · ${caixaAtual.operador}` : 'Caixa fechado';
    badge.classList.toggle('open', !!caixaAtual);
}

function solicitarAberturaCaixa() {
    document.getElementById('input-fundo-caixa').value = '';
    document.getElementById('modal-abertura-caixa').classList.add('active');
    document.getElementById('input-fundo-caixa').focus();
}

function fecharAberturaCaixa() {
    document.getElementById('modal-abertura-caixa').classList.remove('active');
}

async function confirmarAberturaCaixa() {
    const campo = document.getElementById('input-fundo-caixa');
    const val = Number(campo.value);
    if (campo.value === '' || !Number.isFinite(val) || val < 0) return avisar('Informe um fundo de caixa válido (pode ser 0).');
    try {
        caixaAtual = (await api('/api/caixa/abrir', {method: 'POST', body: {fundo: val}})).caixa;
        avisar('Caixa aberto.');
    } catch (e) {
        avisar(e.message);
        await carregarCaixa();
        if (!caixaAtual) return;
    }
    fecharAberturaCaixa();
    atualizarBadgeCaixa();
    carregarVendas();
    if (abaAtiva() === 'caixa') renderizarFechamento();
}

async function renderizarFechamento() {
    const box = document.getElementById('caixa-resumo-box');
    await carregarCaixa();
    let html;
    if (!caixaAtual) {
        html = `<p class="field-help" style="margin:0 0 14px;">O caixa está fechado.</p><button class="btn btn-primary" onclick="solicitarAberturaCaixa()">Abrir caixa</button>`;
    } else {
        html = `<div class="cards-resumo">
            <div class="card-resumo"><span>Aberto em</span><strong>${escaparHtml(formatarDataHora(caixaAtual.abertoEm))}</strong></div>
            <div class="card-resumo"><span>Aberto por</span><strong>${escaparHtml(caixaAtual.operador)}</strong></div>
            <div class="card-resumo"><span>Fundo de troco</span><strong>${formatarMoeda(caixaAtual.fundo)}</strong></div>
        </div>`;
        if (caixaAtual.resumo) html += `<div class="painel" style="margin-bottom:20px;"><h3>Resumo até agora</h3>${tabelaResumoCaixa(caixaAtual.resumo)}</div>`;
        html += `<form class="fechamento-form" onsubmit="event.preventDefault(); fecharCaixa()">
            <h3>Fechar o caixa</h3>
            <p class="field-help">Conte todo o dinheiro da gaveta, incluindo o fundo de troco, e informe o total.${ehAdmin() ? '' : ' A conferência dos valores é feita pelo administrador.'}</p>
            <label for="caixa-contado">Dinheiro contado na gaveta (R$)</label><input id="caixa-contado" type="number" min="0" step="0.01" required placeholder="0,00">
            <label for="caixa-observacao">Observação <span class="optional">(opcional)</span></label><input id="caixa-observacao" maxlength="200" placeholder="Ex.: retirada para pagar fornecedor">
            <button class="btn btn-primary full-width" type="submit" style="margin-top:18px;">Fechar caixa</button>
        </form>`;
    }
    if (ehAdmin()) html += `<h3 style="margin:26px 0 12px;">Caixas anteriores</h3><div id="caixas-historico" class="field-help">Carregando…</div>`;
    box.innerHTML = html;
    if (ehAdmin()) carregarHistoricoCaixas();
}

function tabelaResumoCaixa(r) {
    const linhas = r.pagamentos.map(p => `<tr><td>${escaparHtml(p.metodo)}</td><td class="num">${formatarMoeda(p.valor)}</td></tr>`).join('');
    return `<table class="table-items"><tbody>
        <tr><td>Vendas</td><td class="num">${r.vendas}</td></tr>
        <tr><td><strong>Total vendido</strong></td><td class="num"><strong>${formatarMoeda(r.total)}</strong></td></tr>
        ${linhas}
        <tr><td><strong>Dinheiro esperado na gaveta</strong> <small>(fundo + dinheiro)</small></td><td class="num"><strong>${formatarMoeda(r.dinheiroEsperado)}</strong></td></tr>
        ${r.contado === null ? '' : `<tr><td>Dinheiro contado</td><td class="num">${formatarMoeda(r.contado)}</td></tr><tr><td><strong>Diferença</strong></td><td class="num ${classeDiferenca(r.diferenca)}"><strong>${formatarMoeda(r.diferenca)}</strong></td></tr>`}
    </tbody></table>`;
}

function classeDiferenca(valor) { return valor < 0 ? 'negativo' : valor > 0 ? 'positivo' : ''; }

async function carregarHistoricoCaixas() {
    const box = document.getElementById('caixas-historico');
    try {
        const caixas = (await api('/api/caixas')).filter(c => c.fechadoEm);
        if (!caixas.length) { box.textContent = 'Nenhum caixa fechado ainda.'; return; }
        box.className = '';
        box.innerHTML = '<div class="table-scroll"><table class="table-items"><thead><tr><th>Abertura</th><th>Fechamento</th><th>Operador</th><th class="num">Vendas</th><th class="num">Total vendido</th><th class="num">Dinheiro esperado</th><th class="num">Contado</th><th class="num">Diferença</th></tr></thead><tbody>' +
            caixas.map(c => `<tr><td>${formatarDataHora(c.abertoEm)}</td><td>${formatarDataHora(c.fechadoEm)}<br><small>${escaparHtml(c.fechadoPor || '')}</small></td><td>${escaparHtml(c.operador)}</td><td class="num">${c.resumo.vendas}</td><td class="num">${formatarMoeda(c.resumo.total)}</td><td class="num">${formatarMoeda(c.resumo.dinheiroEsperado)}</td><td class="num">${formatarMoeda(c.resumo.contado)}</td><td class="num ${classeDiferenca(c.resumo.diferenca)}">${formatarMoeda(c.resumo.diferenca)}${c.observacao ? `<br><small>${escaparHtml(c.observacao)}</small>` : ''}</td></tr>`).join('') +
            '</tbody></table></div>';
    } catch (e) { box.textContent = e.message; }
}

async function fecharCaixa() {
    const campo = document.getElementById('caixa-contado');
    const contado = Number(campo.value);
    if (campo.value === '' || !Number.isFinite(contado) || contado < 0) return avisar('Informe o dinheiro contado na gaveta.');
    const abertas = Object.values(comandas).filter(c => c.aberta).length;
    const aviso = abertas ? `Ainda há ${abertas} comanda(s) aberta(s). Elas continuam abertas para o próximo caixa.\n\n` : '';
    if (!confirm(`${aviso}Fechar o caixa com ${formatarMoeda(contado)} em dinheiro na gaveta?`)) return;
    try {
        const r = await api('/api/caixa/fechar', {method: 'POST', body: {contado, observacao: document.getElementById('caixa-observacao').value}});
        caixaAtual = null;
        atualizarBadgeCaixa();
        avisar(r.caixa ? `Caixa fechado. Diferença: ${formatarMoeda(r.caixa.resumo.diferenca)}` : 'Caixa fechado. Obrigado!');
        carregarVendas();
        renderizarFechamento();
    } catch (e) { avisar(e.message); }
}

// ---------- COMANDAS ----------
function comandaVazia() { return { aberta: false, itens: [], adiantamento: 0, desconto: 0 }; }

async function carregarComandas() {
    try {
        const dados = await api('/api/comandas');
        comandas = dados;
        for (let i = 1; i <= TOTAL_COMANDAS; i++) ultimoSalvo[i] = JSON.stringify(comandas[i]);
        comandasCarregadas = true;
    } catch (e) { avisar(e.message); }
    renderizarTudo();
}

// Envia ao servidor só as comandas que mudaram desde o último envio, uma requisição por vez.
function salvarComandas() {
    if (!comandasCarregadas) return filaSalvar;
    const alteradas = {};
    for (let i = 1; i <= TOTAL_COMANDAS; i++) {
        const texto = JSON.stringify(comandas[i]);
        if (texto !== ultimoSalvo[i]) { alteradas[i] = comandas[i]; ultimoSalvo[i] = texto; }
    }
    if (!Object.keys(alteradas).length) return filaSalvar;
    filaSalvar = filaSalvar.then(() => api('/api/comandas', {method: 'PUT', body: {comandas: alteradas}})).catch(async e => {
        avisar('A comanda não foi salva: ' + e.message);
        if (!usuario) return;
        await carregarComandas();
        if (comandaSelecionada) abrirModalComanda(comandaSelecionada);
    });
    return filaSalvar;
}

function calcularFinanceiroComanda(num) {
    const c = comandas[num];
    if (!c || !c.itens) return { subtotal: 0, desconto: 0, adiantamento: 0, total: 0 };
    const subtotal = c.itens.reduce((acc, item) => acc + totalItemCentavos(item), 0) / 100;
    const total = Math.max(0, centavos(subtotal) - centavos(c.desconto || 0) - centavos(c.adiantamento || 0)) / 100;
    return { subtotal, desconto: c.desconto || 0, adiantamento: c.adiantamento || 0, total };
}

function formatarMoeda(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

function renderizarTudo() {
    renderizarGrid();
    renderizarAbertas();
    renderizarPagas();
    salvarComandas();
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
    const vendas = historicoPagos.filter(v => !v.cancelada).slice(0, 5);
    if (!vendas.length) lista.innerHTML = `<li class="field-help" style="margin:0;">${caixaAtual || ehAdmin() ? 'Nenhuma venda ainda.' : 'Caixa fechado.'}</li>`;
    vendas.forEach(item => {
        const li = document.createElement('li');
        li.className = 'item-card pago';
        li.innerHTML = `
            <div class="info-comanda">
                <span class="titulo">Comanda #${item.comanda.toString().padStart(2, '0')}</span>
                <span class="subtext">${item.status === 'Pago' ? 'Pago' : 'Crediário'} às ${escaparHtml(item.dataHora.slice(11, 16))}</span>
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
    return String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim();
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
        item.obs = obs.trim().slice(0, 200);
        renderizarTudo();
        abrirModalComanda(comandaSelecionada);
    }
}

function removerItem(index) {
    if (!comandaSelecionada) return;
    const item = comandas[comandaSelecionada].itens[index];
    if (!item || !podeReduzirSaldo(totalItemCentavos(item) / 100)) return;
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
        comandas[comandaSelecionada].adiantamento = (centavos(comandas[comandaSelecionada].adiantamento) + centavos(a)) / 100;
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

// ---------- NAVEGAÇÃO ----------
const ABAS_ADMIN = ['relatorios', 'cardapio', 'usuarios', 'impressoras'];
function abaAtiva() { return document.querySelector('.view-section.active')?.id.replace('view-', ''); }

function trocarAba(aba) {
    if (ABAS_ADMIN.includes(aba) && !ehAdmin()) aba = 'pdv';
    document.querySelectorAll('.navbar-menu a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

    document.getElementById(`nav-${aba}`).classList.add('active');
    document.getElementById(`view-${aba}`).classList.add('active');

    if (aba === 'historico') renderizarHistorico();
    if (aba === 'caixa') renderizarFechamento();
    if (aba === 'relatorios') { if (!document.getElementById('rel-inicio').value) aplicarPeriodoRelatorio(); else carregarRelatorio(); }
    if (aba === 'usuarios') carregarUsuarios();
    if (aba === 'cardapio') carregarProdutos();
}

function escaparHtml(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

function centavos(valor) { return Math.round(((valor || 0) + Number.EPSILON) * 100); }
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

// ---------- PAGAMENTO ----------
function receberComandaAtual() {
    if (!comandaSelecionada) return;
    const c = comandas[comandaSelecionada];
    if (!c.itens.length) return avisar('Adicione itens antes de efetuar o pagamento.');
    if (!caixaAtual) { avisar('Abra o caixa antes de receber pagamentos.'); return solicitarAberturaCaixa(); }
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

async function confirmarPagamento() {
    if (!comandaSelecionada) return;
    const dados = valoresPagamento();
    const cliente = document.getElementById('pag-cliente').value.trim();
    const crediario = dados.pagamentos.find(p => p.metodo === 'Crediário')?.valor || 0;
    let erro = dados.erro;
    if (!erro && dados.informado < dados.total) erro = 'Valor insuficiente. Complete o saldo nas formas de pagamento.';
    if (!erro && crediario && !cliente) erro = 'Informe o cliente do crediário.';
    if (erro) { document.getElementById('pag-erro').textContent = erro; return; }
    const botao = document.querySelector('#modal-pagamento button[type=submit]');
    botao.disabled = true;
    const numero = comandaSelecionada;
    try {
        await salvarComandas();
        const venda = await api('/api/vendas', {method: 'POST', body: {comanda: numero, desconto: dados.desconto, pagamentos: dados.pagamentos, cliente: crediario ? cliente : ''}});
        comandas[numero] = comandaVazia();
        ultimoSalvo[numero] = JSON.stringify(comandas[numero]);
        fecharModal();
        renderizarTudo();
        carregarVendas();
        avisar(crediario ? 'Venda registrada com saldo no crediário.' : 'Pagamento registrado. Troco: ' + formatarMoeda(venda.troco));
    } catch (e) {
        document.getElementById('pag-erro').textContent = e.message;
        if (!caixaAtual || /caixa/i.test(e.message)) carregarCaixa();
    } finally { botao.disabled = false; }
}

// ---------- TRANSFERÊNCIA ----------
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

// ---------- HISTÓRICO ----------
async function carregarVendas() {
    try { historicoPagos = await api('/api/vendas'); } catch (e) { avisar(e.message); }
    renderizarPagas();
}

async function renderizarHistorico() {
    const box = document.getElementById('historico-list');
    const inicio = document.getElementById('historico-inicio'), fim = document.getElementById('historico-fim');
    if (!inicio.value) inicio.value = hojeISO();
    if (!fim.value) fim.value = inicio.value;
    document.getElementById('historico-descricao').textContent = ehAdmin() ? 'Todas as vendas do período escolhido.' : 'Vendas do caixa aberto agora.';
    box.textContent = 'Carregando…';
    let vendas;
    try { vendas = await api('/api/vendas' + (ehAdmin() ? `?inicio=${inicio.value}&fim=${fim.value}` : '')); }
    catch (e) { box.textContent = e.message; return; }
    if (!vendas.length) { box.textContent = 'Nenhuma venda registrada.'; return; }
    box.innerHTML = '<div class="table-scroll"><table class="table-items"><thead><tr><th>Comanda</th><th>Data / hora</th><th>Atendente</th><th>Itens</th><th>Pagamento</th><th class="num">Desconto</th><th class="num">Valor</th><th>Status</th>' + (ehAdmin() ? '<th></th>' : '') + '</tr></thead><tbody>' +
        vendas.map(v => `<tr class="${v.cancelada ? 'venda-cancelada' : ''}">
            <td>#${v.comanda}</td>
            <td>${formatarDataHora(v.dataHora)}</td>
            <td>${escaparHtml(v.atendente)}</td>
            <td><small>${v.itens.map(i => `${i.qtd}${i.unidade === 'KG' ? ' kg' : 'x'} ${escaparHtml(i.nome)}`).join('<br>')}</small></td>
            <td>${v.pagamentos.map(p => escaparHtml(p.metodo) + ': ' + formatarMoeda(p.valor)).join('<br>') || 'Saldo quitado'}${v.cliente ? '<br>' + escaparHtml(v.cliente) : ''}</td>
            <td class="num">${formatarMoeda(v.desconto)}</td>
            <td class="num">${formatarMoeda(v.valor)}</td>
            <td class="status-venda">${v.cancelada ? `Cancelada<br><small>${escaparHtml(v.motivoCancelamento)}</small>` : escaparHtml(v.status)}</td>
            ${ehAdmin() ? `<td>${v.cancelada ? '' : `<button class="btn btn-danger btn-sm" onclick="cancelarVenda(${v.id})">Cancelar</button>`}</td>` : ''}
        </tr>`).join('') + '</tbody></table></div>';
}

async function cancelarVenda(id) {
    const motivo = prompt('Motivo do cancelamento (obrigatório):');
    if (motivo === null) return;
    try {
        await api(`/api/vendas/${id}/cancelar`, {method: 'POST', body: {motivo}});
        avisar('Venda cancelada. Ela não entra mais nos relatórios.');
        renderizarHistorico();
        carregarVendas();
    } catch (e) { avisar(e.message); }
}

// ---------- RELATÓRIOS ----------
function aplicarPeriodoRelatorio() {
    const periodo = document.getElementById('rel-periodo').value;
    if (periodo === 'personalizado') return;
    const hoje = new Date();
    let inicio = new Date(hoje), fim = new Date(hoje);
    if (periodo === 'ontem') { inicio.setDate(hoje.getDate() - 1); fim = new Date(inicio); }
    if (periodo === '7dias') inicio.setDate(hoje.getDate() - 6);
    if (periodo === 'mes') inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    if (periodo === 'mespassado') { inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0); }
    if (periodo === 'ano') inicio = new Date(hoje.getFullYear(), 0, 1);
    document.getElementById('rel-inicio').value = hojeISO(inicio);
    document.getElementById('rel-fim').value = hojeISO(fim);
    carregarRelatorio();
}

async function carregarRelatorio() {
    const box = document.getElementById('rel-conteudo');
    const inicio = document.getElementById('rel-inicio').value, fim = document.getElementById('rel-fim').value;
    box.innerHTML = '<p class="field-help">Carregando…</p>';
    try { relatorioAtual = await api(`/api/relatorios?inicio=${inicio}&fim=${fim}`); }
    catch (e) { box.innerHTML = `<p class="form-error">${escaparHtml(e.message)}</p>`; return; }
    const r = relatorioAtual, s = r.resumo;
    const hora = h => String(h).padStart(2, '0') + 'h';
    box.innerHTML = `
        <div class="cards-resumo">
            <div class="card-resumo"><span>Vendas</span><strong>${s.vendas}</strong></div>
            <div class="card-resumo"><span>Faturamento</span><strong>${formatarMoeda(s.faturamento)}</strong></div>
            <div class="card-resumo"><span>Ticket médio</span><strong>${formatarMoeda(s.ticketMedio)}</strong></div>
            <div class="card-resumo"><span>Descontos dados</span><strong>${formatarMoeda(s.descontos)}</strong></div>
            <div class="card-resumo"><span>Canceladas</span><strong>${s.canceladas}</strong><small>${formatarMoeda(s.valorCancelado)}</small></div>
        </div>
        ${s.vendas ? `<div class="relatorio-grid">
            <section class="painel painel-largo">
                <div class="painel-topo"><h3>Produtos mais vendidos</h3><input id="rel-busca-produto" type="search" placeholder="Pesquisar produto ou categoria" aria-label="Pesquisar produto no relatório" oninput="renderizarTabelaProdutos()"></div>
                <div id="rel-produtos"></div>
                <p class="field-help">Valores dos itens antes dos descontos da venda.</p>
            </section>
            <section class="painel"><h3>Categorias</h3>${tabelaRanking(r.categorias, 'categoria', [['Itens', x => x.itens]])}</section>
            <section class="painel"><h3>Formas de pagamento</h3>${tabelaRanking(r.pagamentos, 'metodo', [['Vendas', x => x.vendas]])}</section>
            <section class="painel"><h3>Vendas por dia</h3>${tabelaRanking(r.dias, 'dia', [['Vendas', x => x.vendas]], d => d.split('-').reverse().join('/'), false)}</section>
            <section class="painel"><h3>Horários de movimento</h3>${tabelaRanking(r.horas, 'hora', [['Vendas', x => x.vendas]], hora, false)}</section>
            <section class="painel"><h3>Atendentes</h3>${tabelaRanking(r.atendentes, 'nome', [['Vendas', x => x.vendas]])}</section>
        </div>` : '<p class="field-help">Nenhuma venda neste período.</p>'}`;
    if (s.vendas) renderizarTabelaProdutos();
}

// Tabela com barra proporcional ao valor de cada linha.
function tabelaRanking(linhas, campo, extras = [], formatar = v => v, numerar = true) {
    if (!linhas.length) return '<p class="field-help">Sem dados.</p>';
    const maior = Math.max(...linhas.map(l => l.valor), 0.01);
    const total = linhas.reduce((t, l) => t + l.valor, 0) || 1;
    return `<div class="table-scroll"><table class="table-items ranking"><thead><tr>${numerar ? '<th>#</th>' : ''}<th></th>${extras.map(e => `<th class="num">${e[0]}</th>`).join('')}<th class="num">Valor</th><th class="num">%</th><th></th></tr></thead><tbody>` +
        linhas.map((l, i) => `<tr>${numerar ? `<td>${i + 1}</td>` : ''}<td>${escaparHtml(formatar(l[campo]))}</td>${extras.map(e => `<td class="num">${e[1](l)}</td>`).join('')}<td class="num">${formatarMoeda(l.valor)}</td><td class="num">${(l.valor / total * 100).toFixed(1)}%</td><td><div class="barra"><i style="width:${(l.valor / maior * 100).toFixed(1)}%"></i></div></td></tr>`).join('') +
        '</tbody></table></div>';
}

function renderizarTabelaProdutos() {
    if (!relatorioAtual) return;
    const termo = normalizarBusca(document.getElementById('rel-busca-produto')?.value);
    const ranking = relatorioAtual.produtos.map((p, i) => ({...p, posicao: i + 1}))
        .filter(p => !termo || [p.nome, p.codigo, p.categoria].some(v => normalizarBusca(v).includes(termo)));
    const maior = Math.max(...relatorioAtual.produtos.map(p => p.valor), 0.01);
    const caixa = document.getElementById('rel-produtos');
    if (!ranking.length) { caixa.innerHTML = '<p class="field-help">Nenhum produto encontrado.</p>'; return; }
    caixa.innerHTML = '<div class="table-scroll"><table class="table-items ranking"><thead><tr><th>#</th><th>Produto</th><th>Categoria</th><th class="num">Quantidade</th><th class="num">Vendas</th><th class="num">Valor</th><th></th></tr></thead><tbody>' +
        ranking.map(p => `<tr><td>${p.posicao}</td><td>${escaparHtml(p.nome)}</td><td>${escaparHtml(p.categoria)}</td><td class="num">${p.unidade === 'KG' ? p.quantidade.toLocaleString('pt-BR', {minimumFractionDigits: 3}) + ' kg' : p.quantidade}</td><td class="num">${p.vendas}</td><td class="num">${formatarMoeda(p.valor)}</td><td><div class="barra"><i style="width:${(p.valor / maior * 100).toFixed(1)}%"></i></div></td></tr>`).join('') +
        '</tbody></table></div>';
}

// ---------- USUÁRIOS ----------
async function carregarUsuarios() {
    try { usuariosBase = await api('/api/usuarios'); } catch (e) { avisar(e.message); }
    renderizarUsuarios();
}

function renderizarUsuarios() {
    const tbody = document.getElementById('usuarios-lista');
    tbody.replaceChildren();
    usuariosBase.forEach(u => {
        const tr = document.createElement('tr');
        for (const texto of [u.nome, u.login, u.perfil === 'admin' ? 'Administrador' : 'Atendente', u.ativo ? 'Ativo' : 'Inativo']) { const td = document.createElement('td'); td.textContent = texto; tr.append(td); }
        const td = document.createElement('td'); const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-secondary btn-sm'; btn.textContent = 'Editar'; btn.setAttribute('aria-label', 'Editar ' + u.nome); btn.onclick = () => editarUsuario(u.id); td.append(btn); tr.append(td);
        tbody.append(tr);
    });
}

function novoUsuario() {
    document.getElementById('usuario-form').reset();
    document.getElementById('usuario-id').value = '';
    document.getElementById('usuario-login').disabled = false;
    document.getElementById('usuario-senha').required = true;
    document.getElementById('usuario-senha-ajuda').textContent = 'Mínimo de 6 caracteres.';
    document.getElementById('usuario-form-titulo').textContent = 'Novo usuário';
    document.getElementById('usuario-erro').textContent = '';
    document.getElementById('usuario-nome-input').focus();
}

function editarUsuario(id) {
    const u = usuariosBase.find(u => u.id === id); if (!u) return;
    document.getElementById('usuario-id').value = u.id;
    document.getElementById('usuario-nome-input').value = u.nome;
    document.getElementById('usuario-login').value = u.login;
    document.getElementById('usuario-login').disabled = true;
    document.getElementById('usuario-senha').value = '';
    document.getElementById('usuario-senha').required = false;
    document.getElementById('usuario-senha-ajuda').textContent = 'Deixe em branco para manter a senha atual.';
    document.getElementById('usuario-perfil').value = u.perfil;
    document.getElementById('usuario-ativo').checked = u.ativo;
    document.getElementById('usuario-form-titulo').textContent = 'Editar usuário';
    document.getElementById('usuario-erro').textContent = '';
    document.getElementById('usuario-nome-input').focus();
}

async function salvarUsuario() {
    const id = document.getElementById('usuario-id').value;
    const dados = {nome: document.getElementById('usuario-nome-input').value, login: document.getElementById('usuario-login').value, senha: document.getElementById('usuario-senha').value, perfil: document.getElementById('usuario-perfil').value, ativo: document.getElementById('usuario-ativo').checked};
    try {
        await api('/api/usuarios' + (id ? '/' + id : ''), {method: id ? 'PUT' : 'POST', body: dados});
        avisar('Usuário salvo.');
        novoUsuario();
        carregarUsuarios();
    } catch (e) { document.getElementById('usuario-erro').textContent = e.message; }
}

// ---------- TECLADO ----------
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

// ---------- PRODUTOS ----------
async function carregarProdutos() {
    document.getElementById('produtos-conexao').textContent = 'Conectando ao banco local…';
    try {
        produtosBase = await api('/api/produtos'); produtosConectados = true;
        document.getElementById('produtos-conexao').textContent = 'Produtos salvos no banco local deste computador.';
        document.getElementById('produtos-reconectar').hidden = true;
    } catch (e) {
        produtosConectados = false;
        document.getElementById('produtos-conexao').textContent = e.message;
        document.getElementById('produtos-reconectar').hidden = false;
    }
    document.getElementById('produto-salvar').disabled = !produtosConectados;
    renderizarProdutos(); renderizarAtalhosProdutos();
    if (comandaSelecionada) pesquisarProdutosComanda();
}
function renderizarProdutos() {
    const termo = normalizarBusca(document.getElementById('produto-busca').value);
    const produtos = produtosBase.filter(p => [p.nome,p.codigo,p.codigoBarras,p.categoria].some(v => normalizarBusca(v).includes(termo)));
    const tbody = document.getElementById('produtos-lista'); tbody.replaceChildren();
    if (!produtos.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 6; td.textContent = produtosConectados ? 'Nenhum produto encontrado.' : 'Conecte ao servidor para consultar os produtos.'; tr.append(td); tbody.append(tr); }
    produtos.forEach(p => {
        const tr = document.createElement('tr');
        for (const texto of [p.codigo,p.nome,p.categoria || '—',formatarMoeda(p.preco) + ' / ' + p.unidade.toLowerCase(),p.ativo ? 'Ativo' : 'Inativo']) { const td = document.createElement('td'); td.textContent = texto; tr.append(td); }
        const td = document.createElement('td'); const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-secondary btn-sm'; btn.textContent = 'Editar'; btn.setAttribute('aria-label','Editar ' + p.nome); btn.onclick = () => editarProduto(p.id); td.append(btn); tr.append(td); tbody.append(tr);
    });
    const lista = document.getElementById('categorias-existentes');
    lista.replaceChildren(...[...new Set(produtosBase.map(p => p.categoria).filter(Boolean))].sort().map(c => Object.assign(document.createElement('option'), {value: c})));
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
        const result = await api('/api/produtos' + (id ? '/' + id : ''), {method:id ? 'PUT' : 'POST', body:dados});
        const index = produtosBase.findIndex(p => p.id === result.id);
        if (index < 0) produtosBase.push(result); else produtosBase[index] = result;
        produtosBase.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));
        renderizarProdutos(); renderizarAtalhosProdutos(); novoProduto(); avisar('Produto salvo no banco local.');
    } catch(e) { document.getElementById('produto-erro').textContent = e.message; }
    finally { botao.disabled = !produtosConectados; }
}
