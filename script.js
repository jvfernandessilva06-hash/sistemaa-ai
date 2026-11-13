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
let configImpressoras = null;
let vendasHistorico = [];

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
function novoUid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function lerValor(texto) { return Number(String(texto).trim().replace(/\./g, (m, i, s) => s.includes(',') ? '' : m).replace(',', '.')); }

// ---------- JANELAS DE PERGUNTA ----------
// Substituem prompt/alert/confirm do navegador. Devolvem uma Promise:
// sem campos -> true/false; com campos -> objeto {id: valor} ou null se cancelou.
let dialogoAtual = null;
function dialogo({titulo, mensagem = '', campos = [], ok = 'Confirmar', cancelar = 'Cancelar', perigo = false, validar}) {
    if (dialogoAtual) responderDialogo(false);
    document.getElementById('dialogo-titulo').textContent = titulo;
    document.getElementById('dialogo-mensagem').textContent = mensagem;
    document.getElementById('dialogo-mensagem').hidden = !mensagem;
    document.getElementById('dialogo-erro').textContent = '';
    document.getElementById('dialogo-campos').innerHTML = campos.map(c => `
        <label for="dialogo-${c.id}">${escaparHtml(c.rotulo)}${c.opcional ? ' <span class="optional">(opcional)</span>' : ''}</label>
        ${c.tipo === 'select'
            ? `<select id="dialogo-${c.id}">${c.opcoes.map(o => `<option ${o === c.valor ? 'selected' : ''}>${escaparHtml(o)}</option>`).join('')}</select>`
            : `<input id="dialogo-${c.id}" ${c.tipo === 'dinheiro' ? 'inputmode="decimal"' : ''} ${c.tipo === 'senha' ? 'type="password"' : ''} maxlength="${c.max || 200}" value="${escaparHtml(c.valor ?? '')}" placeholder="${escaparHtml(c.placeholder || '')}" autocomplete="${c.tipo === 'senha' ? 'new-password' : 'off'}">`}`).join('');
    const botaoOk = document.getElementById('dialogo-ok');
    botaoOk.textContent = ok;
    botaoOk.className = `btn ${perigo ? 'btn-danger-forte' : 'btn-primary'}`;
    document.getElementById('dialogo-cancelar').textContent = cancelar;
    document.getElementById('dialogo-cancelar').hidden = !cancelar;
    document.getElementById('modal-dialogo').classList.add('active');
    const primeiro = campos.length ? document.getElementById(`dialogo-${campos[0].id}`) : botaoOk;
    primeiro.focus();
    primeiro.select?.();
    return new Promise(resolve => { dialogoAtual = {resolve, campos, validar, voltar: focoAntesDoDialogo}; });
}
let focoAntesDoDialogo = null;
document.addEventListener('focusin', e => { if (!e.target.closest?.('#modal-dialogo')) focoAntesDoDialogo = e.target; });
function responderDialogo(confirmou) {
    const atual = dialogoAtual;
    if (!atual) return;
    let resposta = confirmou;
    if (confirmou && atual.campos.length) {
        resposta = Object.fromEntries(atual.campos.map(c => { const v = document.getElementById(`dialogo-${c.id}`).value; return [c.id, c.tipo === 'senha' ? v : v.trim()]; }));
        const erro = atual.validar?.(resposta);
        if (erro) { document.getElementById('dialogo-erro').textContent = erro; return; }
    }
    if (!confirmou && atual.campos.length) resposta = null;
    dialogoAtual = null;
    document.getElementById('modal-dialogo').classList.remove('active');
    atual.voltar?.focus?.();
    atual.resolve(resposta);
}
const avisarDialogo = (titulo, mensagem) => dialogo({titulo, mensagem, ok: 'Entendi', cancelar: ''});

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
    await Promise.all([carregarProdutos(), carregarComandas(), carregarCaixa(), carregarVendas(), carregarImpressoras(), atualizarFila(), carregarCrediario()]);
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
        if (caixaAtual.resumo) html += `<div class="painel bloco"><h3>Resumo até agora</h3>${tabelaResumoCaixa(caixaAtual.resumo)}</div>`;
        const movimentos = caixaAtual.movimentos || [];
        html += `<div class="painel bloco">
            <div class="painel-topo"><h3>Retiradas e reforços</h3><div class="acoes-linha">
                <button class="btn btn-secondary" type="button" onclick="registrarMovimento('sangria')">Retirar dinheiro (sangria)</button>
                <button class="btn btn-secondary" type="button" onclick="registrarMovimento('suprimento')">Reforçar troco (suprimento)</button>
            </div></div>
            ${movimentos.length ? `<div class="table-scroll"><table class="table-items"><thead><tr><th>Hora</th><th>Tipo</th><th>Motivo</th><th>Quem</th><th class="num">Valor</th></tr></thead><tbody>${movimentos.map(m => `<tr><td>${formatarDataHora(m.dataHora).slice(11)}</td><td>${m.tipo === 'sangria' ? 'Retirada' : 'Reforço'}</td><td>${escaparHtml(m.motivo || '—')}</td><td>${escaparHtml(m.usuario)}${m.autorizadoPor ? `<br><small>Autorizou: ${escaparHtml(m.autorizadoPor)}</small>` : ''}</td><td class="num">${m.tipo === 'sangria' ? '−' : '+'} ${formatarMoeda(m.valor)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="field-help">Nenhuma retirada ou reforço neste caixa. Registre aqui quando tirar dinheiro da gaveta (ex.: pagar o gelo) ou colocar mais troco.</p>'}
        </div>`;
        html += `<form class="painel fechamento-form" onsubmit="event.preventDefault(); fecharCaixa()">
            <h3>Fechar o caixa</h3>
            <p class="field-help">Conte todo o dinheiro da gaveta, incluindo o fundo de troco, e informe o total.${ehAdmin() ? '' : ' A conferência dos valores é feita pelo administrador.'}</p>
            <label for="caixa-contado">Dinheiro contado na gaveta (R$)</label><input id="caixa-contado" type="number" min="0" step="0.01" required placeholder="0,00">
            <label for="caixa-observacao">Observação <span class="optional">(opcional)</span></label><input id="caixa-observacao" maxlength="200">
            <button class="btn btn-primary full-width" type="submit">Fechar caixa</button>
        </form>`;
    }
    if (ehAdmin()) html += `<h3 class="subtitulo">Caixas anteriores</h3><div id="caixas-historico" class="field-help">Carregando…</div>`;
    box.innerHTML = html;
    if (ehAdmin()) carregarHistoricoCaixas();
}

function tabelaResumoCaixa(r) {
    const linhas = r.pagamentos.map(p => `<tr><td>${escaparHtml(p.metodo)}</td><td class="num">${formatarMoeda(p.valor)}</td></tr>`).join('');
    return `<table class="table-items"><tbody>
        <tr><td>Vendas</td><td class="num">${r.vendas}</td></tr>
        <tr><td><strong>Total vendido</strong></td><td class="num"><strong>${formatarMoeda(r.total)}</strong></td></tr>
        ${linhas}
        ${(r.recebimentosCrediario || []).map(p => `<tr><td>Crediário recebido · ${escaparHtml(p.metodo)}</td><td class="num">${formatarMoeda(p.valor)}</td></tr>`).join('')}
        ${r.suprimentos ? `<tr><td>Reforços de troco</td><td class="num">+ ${formatarMoeda(r.suprimentos)}</td></tr>` : ''}
        ${r.sangrias ? `<tr><td>Retiradas</td><td class="num">− ${formatarMoeda(r.sangrias)}</td></tr>` : ''}
        <tr><td><strong>Dinheiro esperado na gaveta</strong> <small>(fundo + dinheiro + reforços − retiradas)</small></td><td class="num"><strong>${formatarMoeda(r.dinheiroEsperado)}</strong></td></tr>
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
    const aviso = abertas ? ` Ainda há ${abertas} comanda(s) aberta(s); elas continuam abertas para o próximo caixa.` : '';
    if (!await dialogo({titulo: 'Fechar o caixa?', mensagem: `Dinheiro contado na gaveta: ${formatarMoeda(contado)}.${aviso}`, ok: 'Fechar caixa'})) return;
    try {
        const r = await api('/api/caixa/fechar', {method: 'POST', body: {contado, observacao: document.getElementById('caixa-observacao').value}});
        caixaAtual = null;
        atualizarBadgeCaixa();
        avisar(r.caixa ? `Caixa fechado. Diferença: ${formatarMoeda(r.caixa.resumo.diferenca)}` : 'Caixa fechado. Obrigado!');
        carregarVendas();
        renderizarFechamento();
    } catch (e) { avisar(e.message); }
}

// Se a senha estiver errada, a janela volta com o valor e o motivo já preenchidos.
async function registrarMovimento(tipo, anterior = {}) {
    const sangria = tipo === 'sangria';
    const r = await dialogo({
        titulo: sangria ? 'Retirar dinheiro da gaveta' : 'Reforçar o troco',
        mensagem: sangria ? 'Registre todo dinheiro que sair da gaveta para o fechamento bater.' : 'Registre o dinheiro que entrou na gaveta sem ser venda.',
        campos: [{id: 'valor', rotulo: 'Valor (R$)', tipo: 'dinheiro', placeholder: '0,00', valor: anterior.valor}, {id: 'motivo', rotulo: 'Motivo', valor: anterior.motivo, placeholder: sangria ? 'Ex.: pagamento do gelo' : 'Ex.: troco trazido pelo dono', opcional: !sangria},
            ...(sangria ? [{id: 'senhaAdmin', rotulo: 'Senha do administrador (para autorizar)', tipo: 'senha', max: 100}] : [])],
        ok: sangria ? 'Registrar retirada' : 'Registrar reforço',
        validar: v => !(lerValor(v.valor) > 0) ? 'Informe um valor maior que zero.' : sangria && !v.motivo ? 'Informe o motivo da retirada.' : sangria && !v.senhaAdmin ? 'Digite a senha do administrador.' : ''
    });
    if (!r) return;
    try {
        caixaAtual = (await api('/api/caixa/movimento', {method: 'POST', body: {tipo, valor: lerValor(r.valor), motivo: r.motivo, senhaAdmin: r.senhaAdmin}})).caixa;
        avisar(sangria ? 'Retirada registrada.' : 'Reforço registrado.');
        renderizarFechamento();
    } catch (e) {
        avisar(e.message);
        if (sangria && /senha/i.test(e.message)) registrarMovimento(tipo, {valor: r.valor, motivo: r.motivo});
    }
}

// ---------- COMANDAS ----------
function comandaVazia() { return { aberta: false, itens: [], adiantamento: 0, desconto: 0 }; }

async function carregarComandas() {
    try {
        const dados = await api('/api/comandas');
        // Itens antigos ganham um identificador para o registro de retiradas funcionar.
        for (const c of Object.values(dados)) c.itens.forEach(i => { if (!i.uid) i.uid = novoUid(); if (!i.adicionais) i.adicionais = []; });
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
    const transferencia = transferenciaPendente;
    transferenciaPendente = null;
    filaSalvar = filaSalvar.then(() => api('/api/comandas', {method: 'PUT', body: {comandas: alteradas, transferencia}})).catch(async e => {
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

let transferenciaPendente = null;
function renderizarTudo() {
    renderizarGrid();
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

        // Itens que ainda não foram para a cozinha: aviso com texto, não só cor.
        const pendentes = comandas[i].itens.filter(item => item.requerCozinha && !item.impresso).length;

        const card = document.createElement('button');
        card.type = 'button';
        card.setAttribute('aria-label', `Comanda ${i}, ${estaAberta ? formatarMoeda(fin.total) : 'livre'}${pendentes ? `, ${pendentes} item(ns) para enviar à cozinha` : ''}`);
        card.className = `comanda-card ${estaAberta ? 'comanda-ocupada' : 'comanda-livre'} ${pendentes ? 'has-pending' : ''}`;
        card.onclick = () => abrirModalComanda(i);
        card.innerHTML = `
            <span class="numero">${i.toString().padStart(2, '0')}</span>
            <span class="valor">${estaAberta ? formatarMoeda(fin.total) : 'Livre'}</span>
            ${pendentes ? '<span class="pendente-cozinha" aria-hidden="true">Cozinha</span>' : ''}
        `;
        container.appendChild(card);
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


function abrirModalComanda(numero) {
    if (comandaSelecionada !== numero) limparBuscaComanda();
    comandaSelecionada = numero;
    const c = comandas[numero];

    document.getElementById('modal-titulo').innerText = `Comanda #${numero.toString().padStart(2, '0')}`;
    document.getElementById('modal-vibra').value = c.vibra || numero;

    const tbody = document.getElementById('modal-tabela-itens');
    tbody.innerHTML = '';

    if (c.itens.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="vazio">Nenhum item. Busque um produto acima ou use os atalhos.</td></tr>`;
    } else {
        c.itens.forEach((item, index) => {
            let statusCozinhaHtml = '<span class="status-badge badge-no-kitchen">Não vai</span>';
            if (item.requerCozinha) {
                statusCozinhaHtml = item.impresso
                    ? '<span class="status-badge badge-printed">Enviado</span>'
                    : `<span class="status-badge badge-pending">A enviar${item.qtdImpressa ? ` +${quantidadeTexto({...item, qtd: qtdPendenteCozinha(item)}).replace(/x$/, '')}` : ''}</span>`;
            }
            const nome = escaparHtml(item.nome);
            const adicionais = item.adicionais || [];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <strong>${nome}</strong>
                    ${adicionais.length ? `<span class="item-adicionais">${adicionais.map(a => `+ ${a.qtd > 1 ? a.qtd + 'x ' : ''}${escaparHtml(a.nome)}`).join(', ')}</span>` : ''}
                    ${item.obs ? `<span class="item-obs">Obs: ${escaparHtml(item.obs)}</span>` : ''}
                    <span class="item-acoes">
                        <button class="btn btn-secondary btn-sm" type="button" onclick="adicionarObservacao(${index})" aria-label="Observação de ${nome}">Obs</button>
                        ${item.aceitaAdicionais || adicionais.length ? `<button class="btn btn-secondary btn-sm" type="button" onclick="abrirAdicionais(${index})" aria-label="Adicionais de ${nome}">Adicionais</button>` : ''}
                    </span>
                </td>
                <td>
                    <span class="qtd-celula"><input class="item-quantity" aria-label="Quantidade de ${nome}" type="number" min="${item.unidade === 'KG' ? '0.001' : '1'}" step="${item.unidade === 'KG' ? '0.001' : '1'}" value="${item.qtd}" onchange="definirQuantidadeItem(${index}, this.value)"><small>${item.unidade === 'KG' ? 'kg' : 'un'}</small></span>
                </td>
                <td class="num">${formatarMoeda(item.preco)}<small> / ${(item.unidade || 'UN').toLowerCase()}</small></td>
                <td class="num">${formatarMoeda(totalItemCentavos(item) / 100)}</td>
                <td>${statusCozinhaHtml}</td>
                <td><button class="btn btn-remover" type="button" onclick="removerItem(${index})" aria-label="Remover ${nome}" title="Remover">&times;</button></td>
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
    if (!comandaSelecionada || !prod.ativo) return false;
    comandas[comandaSelecionada].aberta = true;

    // Todo item novo que requer cozinha começa como impresso = false
    comandas[comandaSelecionada].itens.push({
        ...prod,
        uid: novoUid(),
        qtd: prod.unidade === 'KG' ? 0.100 : 1,
        obs: "",
        impresso: false,
        adicionais: []
    });

    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
    return false;
}

// ---------- ADICIONAIS ----------
let itemAdicionais = null;
function abrirAdicionais(index) {
    const item = comandas[comandaSelecionada]?.itens[index];
    if (!item) return;
    if (qtdImpressa(item)) return avisar('Este item já foi para a cozinha. Para mudar os adicionais, remova e lance de novo.');
    itemAdicionais = index;
    document.getElementById('adicionais-item').textContent = `${item.nome}${item.unidade === 'UN' && item.qtd > 1 ? ` (${item.qtd} unidades: os adicionais valem para cada uma)` : ''}`;
    renderizarAdicionais();
    document.getElementById('modal-comanda').inert = true;
    document.getElementById('modal-adicionais').classList.add('active');
    document.querySelector('#adicionais-lista button')?.focus();
}
function renderizarAdicionais() {
    const item = comandas[comandaSelecionada].itens[itemAdicionais];
    const lista = document.getElementById('adicionais-lista');
    const escolhidos = new Map((item.adicionais || []).map(a => [a.id, a.qtd]));
    lista.innerHTML = produtosBase.filter(p => p.ativo && p.adicional).map(p => {
        const qtd = escolhidos.get(p.id) || 0;
        const nome = escaparHtml(p.nome);
        return `<div class="adicional ${qtd ? 'escolhido' : ''}">
            <button type="button" class="adicional-nome" onclick="mudarAdicional(${p.id}, 1)" aria-label="Adicionar ${nome}, ${formatarMoeda(p.preco)}${qtd ? `, escolhido ${qtd} vez(es)` : ''}">
                <span>${nome}</span><small>${formatarMoeda(p.preco)}</small>
            </button>
            ${qtd ? `<span class="adicional-qtd"><button type="button" class="btn btn-secondary btn-sm" onclick="mudarAdicional(${p.id}, -1)" aria-label="Tirar um ${nome}">−</button><strong aria-hidden="true">${qtd}</strong></span>` : ''}
        </div>`;
    }).join('') || '<p class="field-help">Nenhum produto marcado como adicional. Cadastre em Produtos.</p>';
    document.getElementById('adicionais-total').textContent = formatarMoeda((item.adicionais || []).reduce((s, a) => s + centavos(a.preco) * a.qtd, 0) / 100);
}
function mudarAdicional(produtoId, passo) {
    const item = comandas[comandaSelecionada].itens[itemAdicionais];
    const produto = produtosBase.find(p => p.id === produtoId);
    item.adicionais = item.adicionais || [];
    const atual = item.adicionais.find(a => a.id === produtoId);
    if (atual) atual.qtd = Math.min(20, atual.qtd + passo);
    else if (passo > 0) item.adicionais.push({id: produto.id, codigo: produto.codigo, nome: produto.nome, categoria: produto.categoria, preco: produto.preco, qtd: 1});
    item.adicionais = item.adicionais.filter(a => a.qtd > 0);
    const foco = document.activeElement?.getAttribute('onclick');
    renderizarAdicionais();
    document.querySelector(`#adicionais-lista [onclick="${foco}"]`)?.focus();
}
function fecharAdicionais() {
    if (itemAdicionais === null) return;
    itemAdicionais = null;
    document.getElementById('modal-adicionais').classList.remove('active');
    document.getElementById('modal-comanda').inert = false;
    renderizarTudo();
    if (comandaSelecionada) abrirModalComanda(comandaSelecionada);
    document.getElementById('input-item-modal').focus();
}

function normalizarBusca(valor) {
    return String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim();
}
// ---------- BUSCA INTELIGENTE ----------
// Cada palavra digitada precisa combinar com alguma palavra do produto, em qualquer ordem,
// aceitando começo de palavra ("panq") e erros de digitação ("panquica", "frnago").
const PALAVRAS_IGNORADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'a', 'o', 'em', 'no', 'na', 'c']);
function palavrasBusca(texto) {
    return normalizarBusca(texto).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(p => p && !PALAVRAS_IGNORADAS.has(p));
}

// Distância entre duas palavras: quantas letras trocar, tirar, pôr ou inverter de lugar.
function distanciaPalavras(a, b) {
    const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const custo = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

function notaPalavra(busca, palavra) {
    if (palavra === busca) return 3;
    if (palavra.startsWith(busca)) return 2.5;
    if (busca.length >= 3 && palavra.includes(busca)) return 2;
    const tolerancia = busca.length <= 3 ? 0 : busca.length <= 5 ? 1 : 2;
    if (!tolerancia || /^\d+$/.test(busca)) return 0;
    // Erro na palavra inteira ou no começo dela (quando ainda está digitando).
    const erros = Math.min(distanciaPalavras(busca, palavra), distanciaPalavras(busca, palavra.slice(0, busca.length)));
    return erros <= tolerancia ? 1.5 - erros * 0.25 : 0;
}

// Devolve a nota do item para a busca (0 = não combina). Código e código de barras exatos vêm primeiro.
function notaBusca(termo, {nome, extras = [], codigos = []}) {
    const busca = normalizarBusca(termo);
    if (!busca) return 0;
    if (codigos.some(c => c && normalizarBusca(c) === busca)) return 1000;
    const palavrasItem = palavrasBusca([nome, ...extras].join(' '));
    const codigosItem = codigos.filter(Boolean).map(normalizarBusca);
    const palavrasTermo = palavrasBusca(busca);
    if (!palavrasTermo.length) return normalizarBusca(nome).includes(busca) ? 1 : 0;
    let total = 0;
    for (const p of palavrasTermo) {
        const melhor = Math.max(0, ...palavrasItem.map(w => notaPalavra(p, w)), ...codigosItem.map(c => c.startsWith(p) ? 2 : 0));
        if (!melhor) return 0;
        total += melhor;
    }
    if (normalizarBusca(nome) === busca) total += 50;
    else if (palavrasBusca(nome)[0]?.startsWith(palavrasTermo[0])) total += 1;
    return total;
}

function buscarInteligente(lista, termo, campos) {
    return lista.map(item => ({item, nota: notaBusca(termo, campos(item))}))
        .filter(r => r.nota > 0)
        .sort((a, b) => b.nota - a.nota || campos(a.item).nome.localeCompare(campos(b.item).nome, 'pt-BR'))
        .map(r => r.item);
}

const camposProduto = p => ({nome: p.nome, extras: [p.categoria], codigos: [p.codigo, p.codigoBarras]});
function encontrarProdutos(termo) {
    return buscarInteligente(produtosBase.filter(p => p.ativo), termo, camposProduto);
}
function limparBuscaComanda() {
    document.getElementById('input-item-modal').value = '';
    document.getElementById('busca-produtos-resultados').replaceChildren();
    document.getElementById('busca-produtos-resultados').hidden = true;
    document.getElementById('busca-produtos-status').hidden = true;
}
function selecionarProdutoBusca(produto) {
    limparBuscaComanda();
    if (!inserirProdutoDireto(produto)) document.getElementById('input-item-modal').focus();
}
function pesquisarProdutosComanda() {
    const termo = document.getElementById('input-item-modal').value;
    const container = document.getElementById('busca-produtos-resultados');
    const status = document.getElementById('busca-produtos-status');
    container.replaceChildren();
    if (!normalizarBusca(termo)) { container.hidden = true; status.hidden = true; return; }
    resultadosBusca = encontrarProdutos(termo).slice(0, 30);
    indiceBusca = 0;
    container.hidden = resultadosBusca.length === 0;
    document.getElementById('input-item-modal').setAttribute('aria-expanded', String(resultadosBusca.length > 0));
    status.hidden = false;
    status.textContent = !produtosConectados ? 'Conecte ao servidor local para pesquisar os produtos.' : resultadosBusca.length ? 'Use ↑ ↓ para escolher e Enter para adicionar.' : 'Nenhum produto encontrado. Tente outra palavra ou o código.';
    resultadosBusca.forEach((prod, i) => {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'search-result'; btn.id = 'resultado-busca-' + i;
        btn.setAttribute('role', 'option');
        const nome = document.createElement('strong'); nome.textContent = prod.nome;
        const codigo = document.createElement('span'); codigo.textContent = 'Código ' + prod.codigo;
        const preco = document.createElement('span'); preco.textContent = formatarMoeda(prod.preco) + ' / ' + prod.unidade.toLowerCase();
        btn.append(nome,codigo,preco); btn.onclick = () => selecionarProdutoBusca(prod); container.append(btn);
    });
    destacarResultadoBusca();
}

let resultadosBusca = [];
let indiceBusca = 0;
function destacarResultadoBusca() {
    document.querySelectorAll('#busca-produtos-resultados .search-result').forEach((btn, i) => btn.classList.toggle('ativo', i === indiceBusca));
    const ativo = document.getElementById('resultado-busca-' + indiceBusca);
    document.getElementById('input-item-modal').setAttribute('aria-activedescendant', ativo ? ativo.id : '');
    ativo?.scrollIntoView({block: 'nearest'});
}
function moverResultadoBusca(passo) {
    if (!resultadosBusca.length) return;
    indiceBusca = (indiceBusca + passo + resultadosBusca.length) % resultadosBusca.length;
    destacarResultadoBusca();
}

// Enter adiciona o produto destacado (o mais provável, a não ser que tenha mudado com as setas).
function adicionarItemPorPesquisa() {
    if (!comandaSelecionada) return;
    const termo = document.getElementById('input-item-modal').value;
    if (!normalizarBusca(termo)) return;
    const encontrados = encontrarProdutos(termo);
    const escolhido = resultadosBusca[indiceBusca] && encontrados.includes(resultadosBusca[indiceBusca]) ? resultadosBusca[indiceBusca] : encontrados[0];
    if (escolhido) selecionarProdutoBusca(escolhido);
    else pesquisarProdutosComanda();
}

async function adicionarObservacao(index) {
    if (!comandaSelecionada) return;
    const numero = comandaSelecionada;
    const item = comandas[numero].itens[index];
    const r = await dialogo({titulo: 'Observação', mensagem: item.nome, campos: [{id: 'obs', rotulo: 'Observação para a cozinha', valor: item.obs || '', placeholder: 'Ex.: sem granola', max: 200}], ok: 'Salvar'});
    if (!r || comandas[numero].itens[index] !== item) return;
    item.obs = r.obs.slice(0, 200);
    renderizarTudo();
    if (comandaSelecionada === numero) abrirModalComanda(numero);
}

function removerItem(index) {
    if (!comandaSelecionada) return;
    const item = comandas[comandaSelecionada].itens[index];
    if (!item || !podeReduzirSaldo(totalItemCentavos(item) / 100)) return;
    comandas[comandaSelecionada].itens.splice(index, 1);
    renderizarTudo();
    abrirModalComanda(comandaSelecionada);
}

// A comanda que vibra já vem com o número da comanda; só guarda quando é diferente.
function definirVibra(valor) {
    if (!comandaSelecionada) return;
    const c = comandas[comandaSelecionada], campo = document.getElementById('modal-vibra'), n = Number(valor);
    if (valor === '' || n === comandaSelecionada) delete c.vibra;
    else if (Number.isInteger(n) && n >= 1 && n <= 999) c.vibra = n;
    else avisar('Digite o número da comanda que vibra, de 1 a 999.');
    campo.value = c.vibra || comandaSelecionada;
    renderizarTudo();
}

async function imprimirCozinha() {
    if (!comandaSelecionada) return;
    const numero = comandaSelecionada;
    const pendentes = comandas[numero].itens.filter(i => i.requerCozinha && !i.impresso);
    if (pendentes.length === 0) return avisar('Não há itens pendentes para enviar à cozinha.');
    const vibra = comandas[numero].vibra || numero;
    let resultado;
    // Item aumentado depois de enviado: a cozinha recebe só as unidades novas.
    const enviar = pendentes.map(i => ({...i, qtd: qtdPendenteCozinha(i)}));
    try { resultado = await imprimir('cozinha', documentoCozinha(numero, enviar, vibra), {descricao: `Pedido da comanda ${String(numero).padStart(2, '0')} (vibra ${String(vibra).padStart(2, '0')})`}); }
    catch (e) { return avisar(e.message); }
    // Só marca como impresso depois que a impressão foi aceita (ou guardada na fila, que imprime sozinha).
    pendentes.forEach(i => marcarImpresso(i, i.qtd));
    renderizarTudo();
    if (comandaSelecionada === numero) abrirModalComanda(numero);
    avisar(resultado?.naFila ? resultado.mensagem : 'Pedido enviado para a cozinha.');
}

async function adiantarValor() {
    if (!comandaSelecionada) return;
    const numero = comandaSelecionada;
    const saldo = calcularFinanceiroComanda(numero).total;
    const r = await dialogo({
        titulo: 'Adiantamento', mensagem: `O cliente paga uma parte agora. Saldo da comanda: ${formatarMoeda(saldo)}.`,
        campos: [{id: 'valor', rotulo: 'Valor adiantado (R$)', tipo: 'dinheiro', placeholder: '0,00'}], ok: 'Registrar',
        validar: v => { const a = lerValor(v.valor); return !(a > 0) || centavos(a) > centavos(saldo) ? 'Informe um valor entre zero e o saldo a pagar.' : ''; }
    });
    if (!r) return;
    comandas[numero].adiantamento = (centavos(comandas[numero].adiantamento) + centavos(lerValor(r.valor))) / 100;
    renderizarTudo();
    if (comandaSelecionada === numero) abrirModalComanda(numero);
}

async function abrirNovaComandaRapida() {
    const r = await dialogo({
        titulo: 'Abrir comanda', campos: [{id: 'numero', rotulo: 'Número da comanda (1 a 50)', tipo: 'dinheiro', placeholder: 'Ex.: 12', max: 2}], ok: 'Abrir',
        validar: v => { const n = Number(v.numero); return Number.isInteger(n) && n >= 1 && n <= TOTAL_COMANDAS ? '' : 'Digite um número de 1 a 50.'; }
    });
    if (!r) return;
    const n = Number(r.numero);
    comandas[n].aberta = true;
    renderizarTudo();
    abrirModalComanda(n);
    document.getElementById('input-item-modal').focus();
}

// ---------- NAVEGAÇÃO ----------
const ABAS_ADMIN = ['relatorios', 'cardapio', 'usuarios', 'impressoras'];
function abaAtiva() { return document.querySelector('.view-section.active')?.id.replace('view-', ''); }

function trocarAba(aba) {
    if (ABAS_ADMIN.includes(aba) && !ehAdmin()) aba = 'pdv';
    document.querySelectorAll('.navbar-menu button').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

    const botao = document.getElementById(`nav-${aba}`);
    botao.classList.add('active');
    botao.setAttribute('aria-current', 'page');
    document.getElementById(`view-${aba}`).classList.add('active');

    if (aba === 'crediario') { carregarCrediario(); if (ehAdmin() && !document.getElementById('conta-id').value) novaConta(); }
    if (aba === 'historico') renderizarHistorico();
    if (aba === 'caixa') renderizarFechamento();
    if (aba === 'relatorios') { if (!document.getElementById('rel-inicio').value) aplicarPeriodoRelatorio(); else carregarRelatorio(); }
    if (aba === 'usuarios') carregarUsuarios();
    if (aba === 'cardapio') carregarProdutos();
    if (aba === 'impressoras') { carregarImpressoras().then(renderizarImpressoras); carregarBackup(); }
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
    preencherContasPagamento();
    renderizarItensPagamento();
    atualizarPagamento();
    document.getElementById('modal-comanda').inert = true;
    document.getElementById('modal-pagamento').classList.add('active');
    document.getElementById('pag-desconto').focus();
}

// Lista da comanda ao lado do pagamento: marcando os itens de uma pessoa, aparece quanto ela paga.
function renderizarItensPagamento() {
    const itens = comandas[comandaSelecionada].itens;
    document.getElementById('pag-itens').innerHTML = itens.map((item, i) => {
        const adicionais = (item.adicionais || []).map(a => `+ ${a.qtd > 1 ? a.qtd + 'x ' : ''}${escaparHtml(a.nome)}`).join(', ');
        return `<li><label class="pag-item">
            <input type="checkbox" data-indice="${i}" onchange="somarItensMarcados()">
            <span class="pag-item-nome"><strong>${item.unidade === 'KG' ? quantidadeTexto(item) : item.qtd + 'x'} ${escaparHtml(item.nome)}</strong>${adicionais ? `<small>${adicionais}</small>` : ''}${item.unidade === 'UN' && item.qtd > 1 ? `<small>${formatarMoeda(totalItemCentavos({...item, qtd: 1}) / 100)} cada</small>` : ''}</span>
            <span class="pag-item-valor">${formatarMoeda(totalItemCentavos(item) / 100)}</span>
        </label></li>`;
    }).join('');
    somarItensMarcados();
}
function somarItensMarcados() {
    const itens = comandas[comandaSelecionada]?.itens || [];
    const total = [...document.querySelectorAll('#pag-itens input:checked')].reduce((s, c) => s + totalItemCentavos(itens[Number(c.dataset.indice)]), 0);
    document.getElementById('pag-selecionados').textContent = formatarMoeda(total / 100);
}

function preencherContasPagamento() {
    const select = document.getElementById('pag-conta');
    const ativas = contasCrediario.filter(c => c.ativo);
    const grupo = (titulo, lista) => lista.length ? `<optgroup label="${titulo}">${lista.map(c => `<option value="${c.id}">${escaparHtml(c.nome)} · ${formatarDocumento(c.documento)}</option>`).join('')}</optgroup>` : '';
    select.innerHTML = '<option value="">Escolha…</option>' + grupo('Loja', ativas.filter(c => c.tipo === 'empresa')) + grupo('Funcionários', ativas.filter(c => c.tipo === 'funcionario'));
    document.getElementById('pag-conta-ajuda').hidden = ativas.length > 0;
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
    document.querySelectorAll('.payment-card').forEach(card => card.classList.toggle('filled', Number(card.querySelector('input').value) > 0));
}

async function confirmarPagamento() {
    if (!comandaSelecionada) return;
    const dados = valoresPagamento();
    const conta = Number(document.getElementById('pag-conta').value) || null;
    const crediario = dados.pagamentos.find(p => p.metodo === 'Crediário')?.valor || 0;
    let erro = dados.erro;
    if (!erro && dados.informado < dados.total) erro = 'Valor insuficiente. Complete o saldo nas formas de pagamento.';
    if (!erro && crediario && !conta) erro = 'Escolha de quem é o crediário.';
    if (erro) { document.getElementById('pag-erro').textContent = erro; return; }
    const botao = document.querySelector('#modal-pagamento button[type=submit]');
    botao.disabled = true;
    const numero = comandaSelecionada;
    try {
        await salvarComandas();
        const venda = await api('/api/vendas', {method: 'POST', body: {comanda: numero, desconto: dados.desconto, pagamentos: dados.pagamentos, contaCrediario: crediario ? conta : null}});
        comandas[numero] = comandaVazia();
        ultimoSalvo[numero] = JSON.stringify(comandas[numero]);
        fecharModal();
        renderizarTudo();
        carregarVendas();
        avisar(crediario ? 'Venda registrada com saldo no crediário.' : 'Pagamento registrado. Troco: ' + formatarMoeda(venda.troco));
        if (crediario) carregarCrediario();
        const quando = configImpressoras?.comprovante || 'perguntar';
        if (quando === 'sempre' || (quando === 'perguntar' && await dialogo({titulo: 'Pagamento registrado', mensagem: venda.troco ? `Troco: ${formatarMoeda(venda.troco)}. Imprimir o comprovante?` : 'Imprimir o comprovante?', ok: 'Imprimir', cancelar: 'Não imprimir'}))) imprimirComprovante(venda);
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
        // A parte que já foi para a cozinha vai primeiro com a transferência; o resto continua a enviar.
        const jaFoi = qtdImpressa(item), foiJunto = Math.min(jaFoi, quantidades[i]);
        if (quantidades[i]) {
            const copia = {...item, uid: novoUid(), adicionais: (item.adicionais || []).map(a => ({...a})), qtd: quantidades[i]};
            marcarImpresso(copia, foiJunto);
            destino.itens.push(copia);
        }
        item.qtd = Math.round((item.qtd - quantidades[i]) * 1000) / 1000;
        marcarImpresso(item, Math.round((jaFoi - foiJunto) * 1000) / 1000);
    });
    origem.itens = origem.itens.filter(item => item.qtd > 0);
    origem.aberta = origem.itens.length > 0;
    destino.aberta = true;
    // Avisa o servidor que foi transferência, para o registro não contar como item retirado.
    transferenciaPendente = {origem: comandaSelecionada, destino: numeroDestino};
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
    if (ehAdmin()) renderizarRegistro();
    box.textContent = 'Carregando…';
    let vendas;
    try { vendas = await api('/api/vendas' + (ehAdmin() ? `?inicio=${inicio.value}&fim=${fim.value}` : '')); }
    catch (e) { box.textContent = e.message; return; }
    if (!vendas.length) { box.textContent = 'Nenhuma venda registrada.'; return; }
    box.innerHTML = '<div class="table-scroll"><table class="table-items"><thead><tr><th>Comanda</th><th>Data / hora</th><th>Atendente</th><th>Itens</th><th>Pagamento</th><th class="num">Desconto</th><th class="num">Valor</th><th>Status</th><th></th></tr></thead><tbody>' +
        vendas.map(v => `<tr class="${v.cancelada ? 'venda-cancelada' : ''}">
            <td>#${v.comanda}</td>
            <td>${formatarDataHora(v.dataHora)}</td>
            <td>${escaparHtml(v.atendente)}</td>
            <td><small>${v.itens.map(i => `${i.qtd}${i.unidade === 'KG' ? ' kg' : 'x'} ${escaparHtml(i.nome)}${(i.adicionais || []).length ? ` (+ ${i.adicionais.map(a => escaparHtml(a.nome)).join(', ')})` : ''}`).join('<br>')}</small></td>
            <td>${v.pagamentos.map(p => escaparHtml(p.metodo) + ': ' + formatarMoeda(p.valor)).join('<br>') || 'Saldo quitado'}${v.cliente ? '<br>' + escaparHtml(v.cliente) : ''}</td>
            <td class="num">${formatarMoeda(v.desconto)}</td>
            <td class="num">${formatarMoeda(v.valor)}</td>
            <td class="status-venda">${v.cancelada ? `Cancelada<br><small>${escaparHtml(v.motivoCancelamento)}</small>` : escaparHtml(v.status)}</td>
            <td class="acoes-venda">${v.cancelada ? '' : `<button class="btn btn-secondary btn-sm" type="button" onclick="reimprimirVenda(${v.id})" aria-label="Imprimir comprovante da comanda ${v.comanda}">Imprimir</button>`}${ehAdmin() && !v.cancelada ? ` <button class="btn btn-danger btn-sm" type="button" onclick="cancelarVenda(${v.id})" aria-label="Cancelar venda da comanda ${v.comanda}">Cancelar</button>` : ''}</td>
        </tr>`).join('') + '</tbody></table></div>';
    vendasHistorico = vendas;
}

async function renderizarRegistro() {
    const box = document.getElementById('registro-list');
    const inicio = document.getElementById('historico-inicio').value, fim = document.getElementById('historico-fim').value;
    box.textContent = 'Carregando…';
    let registro;
    try { registro = await api(`/api/registro?inicio=${inicio}&fim=${fim}`); } catch (e) { box.textContent = e.message; return; }
    if (!registro.length) { box.textContent = 'Nenhum item foi retirado de comandas neste período.'; return; }
    box.innerHTML = '<div class="table-scroll"><table class="table-items"><thead><tr><th>Data / hora</th><th>Quem</th><th>Comanda</th><th>O que aconteceu</th><th>Cozinha</th></tr></thead><tbody>' +
        registro.map(r => `<tr><td>${formatarDataHora(r.dataHora)}</td><td>${escaparHtml(r.usuario)}</td><td>#${r.comanda}</td><td>${r.acao === 'transferiu' ? 'Transferiu' : 'Retirou'} ${escaparHtml(r.descricao)}</td><td>${r.enviadoCozinha ? '<span class="status-badge badge-pending">Já tinha ido</span>' : '—'}</td></tr>`).join('') +
        '</tbody></table></div>';
}

async function cancelarVenda(id) {
    const r = await dialogo({
        titulo: 'Cancelar venda', mensagem: 'A venda continua no histórico, marcada como cancelada, e sai dos relatórios.',
        campos: [{id: 'motivo', rotulo: 'Motivo do cancelamento', placeholder: 'Ex.: lançada na comanda errada'}],
        ok: 'Cancelar venda', cancelar: 'Voltar', perigo: true, validar: v => v.motivo ? '' : 'Informe o motivo.'
    });
    if (!r) return;
    try {
        await api(`/api/vendas/${id}/cancelar`, {method: 'POST', body: {motivo: r.motivo}});
        avisar('Venda cancelada. Ela não entra mais nos relatórios.');
        renderizarHistorico();
        carregarVendas();
    } catch (e) { avisar(e.message); }
}

// ---------- CREDIÁRIO ----------
let clientesCrediario = [];
let contasCrediario = [];
async function carregarCrediario() {
    try { [clientesCrediario, contasCrediario] = await Promise.all([api('/api/crediario'), api('/api/crediario/contas')]); } catch (e) { avisar(e.message); }
    if (abaAtiva() === 'crediario') { renderizarCrediario(); renderizarContas(); }
}

function formatarDocumento(d) {
    d = String(d || '').replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return d;
}
// Põe pontos e traço enquanto digita.
function formatarCampoDocumento(campo) {
    const d = campo.value.replace(/\D/g, '').slice(0, document.getElementById('conta-tipo').value === 'empresa' ? 14 : 11);
    const mascara = document.getElementById('conta-tipo').value === 'empresa' ? [2, 3, 3, 4, 2] : [3, 3, 3, 2];
    const separadores = document.getElementById('conta-tipo').value === 'empresa' ? ['.', '.', '/', '-'] : ['.', '.', '-'];
    let resultado = '', pos = 0;
    mascara.forEach((tamanho, i) => { const parte = d.slice(pos, pos + tamanho); if (!parte) return; resultado += (i ? separadores[i - 1] : '') + parte; pos += tamanho; });
    campo.value = resultado;
}
function atualizarRotuloDocumento() {
    const empresa = document.getElementById('conta-tipo').value === 'empresa';
    document.getElementById('conta-documento-label').textContent = empresa ? 'CNPJ' : 'CPF';
    const campo = document.getElementById('conta-documento');
    campo.placeholder = empresa ? '00.000.000/0000-00' : '000.000.000-00';
    formatarCampoDocumento(campo);
}

function renderizarContas() {
    const lista = document.getElementById('contas-lista');
    if (!lista) return;
    lista.innerHTML = contasCrediario.map(c => `<li class="${c.ativo ? '' : 'inativa'}">
        <span><strong>${escaparHtml(c.nome)}</strong><small>${c.tipo === 'empresa' ? 'Loja · CNPJ' : 'Funcionário · CPF'} ${formatarDocumento(c.documento)}${c.ativo ? '' : ' · bloqueado'}</small></span>
        <button class="btn btn-secondary btn-sm" type="button" onclick="editarConta(${c.id})" aria-label="Editar ${escaparHtml(c.nome)}">Editar</button>
    </li>`).join('') || '<li class="field-help">Ninguém cadastrado ainda. Cadastre os funcionários e a loja abaixo.</li>';
}
function novaConta() {
    document.getElementById('conta-form').reset();
    document.getElementById('conta-id').value = '';
    document.getElementById('conta-form-titulo').textContent = 'Cadastrar';
    document.getElementById('conta-erro').textContent = '';
    atualizarRotuloDocumento();
}
function editarConta(id) {
    const c = contasCrediario.find(c => c.id === id); if (!c) return;
    document.getElementById('conta-id').value = c.id;
    document.getElementById('conta-tipo').value = c.tipo;
    document.getElementById('conta-nome').value = c.nome;
    document.getElementById('conta-documento').value = c.documento;
    document.getElementById('conta-ativo').checked = c.ativo;
    document.getElementById('conta-form-titulo').textContent = 'Editar';
    document.getElementById('conta-erro').textContent = '';
    atualizarRotuloDocumento();
    document.getElementById('conta-nome').focus();
}
async function salvarConta() {
    const id = document.getElementById('conta-id').value;
    try {
        contasCrediario = await api('/api/crediario/contas' + (id ? '/' + id : ''), {method: id ? 'PUT' : 'POST', body: {
            nome: document.getElementById('conta-nome').value, tipo: document.getElementById('conta-tipo').value,
            documento: document.getElementById('conta-documento').value, ativo: document.getElementById('conta-ativo').checked
        }});
        avisar('Cadastro salvo.');
        novaConta();
        renderizarContas();
    } catch (e) { document.getElementById('conta-erro').textContent = e.message; }
}

function renderizarCrediario() {
    const box = document.getElementById('crediario-lista');
    const termo = document.getElementById('crediario-busca').value;
    const total = clientesCrediario.reduce((s, c) => s + centavos(c.saldo), 0) / 100;
    const lista = normalizarBusca(termo) ? clientesCrediario.filter(c => notaBusca(termo, {nome: c.cliente, codigos: [c.documento]})) : clientesCrediario;
    let html = `<div class="cards-resumo"><div class="card-resumo"><span>Total a receber</span><strong>${formatarMoeda(total)}</strong></div><div class="card-resumo"><span>Devendo</span><strong>${clientesCrediario.length}</strong></div></div>`;
    if (!clientesCrediario.length) html += '<p class="field-help">Ninguém está devendo. Vendas no crediário aparecem aqui.</p>';
    else if (!lista.length) html += '<p class="field-help">Ninguém encontrado.</p>';
    html += lista.map((c, i) => `<details class="painel cliente-crediario" ${lista.length === 1 ? 'open' : ''}>
        <summary><span class="cliente-nome">${escaparHtml(c.cliente)}${c.documento ? `<small>${formatarDocumento(c.documento)}</small>` : ''}</span><span class="cliente-saldo">${formatarMoeda(c.saldo)}</span></summary>
        <div class="table-scroll"><table class="table-items"><thead><tr><th>Compra</th><th>Comanda</th><th class="num">No crediário</th><th class="num">Já pagou</th><th class="num">Falta</th></tr></thead><tbody>
            ${c.vendas.map(v => `<tr><td>${formatarDataHora(v.dataHora)}</td><td>#${v.comanda}</td><td class="num">${formatarMoeda(v.valor)}</td><td class="num">${formatarMoeda(v.pago)}</td><td class="num">${formatarMoeda(v.saldo)}</td></tr>`).join('')}
        </tbody></table></div>
        <button class="btn btn-primary" type="button" onclick="receberDoCliente(${clientesCrediario.indexOf(c)})">Receber de ${escaparHtml(c.cliente)}</button>
    </details>`).join('');
    box.innerHTML = html;
}

async function receberDoCliente(indice) {
    const c = clientesCrediario[indice];
    if (!c) return;
    if (!caixaAtual) { avisar('Abra o caixa antes de receber.'); return solicitarAberturaCaixa(); }
    const r = await dialogo({
        titulo: `Receber de ${c.cliente}`, mensagem: `Deve ${formatarMoeda(c.saldo)}. Pode receber tudo ou só uma parte.`,
        campos: [{id: 'valor', rotulo: 'Valor recebido (R$)', tipo: 'dinheiro', valor: c.saldo.toFixed(2).replace('.', ',')}, {id: 'metodo', rotulo: 'Forma de pagamento', tipo: 'select', opcoes: ['Dinheiro', 'Pix', 'Débito', 'Crédito'], valor: 'Dinheiro'}],
        ok: 'Receber', validar: v => { const n = lerValor(v.valor); return !(n > 0) ? 'Informe um valor maior que zero.' : centavos(n) > centavos(c.saldo) ? 'O valor passa do que o cliente deve.' : ''; }
    });
    if (!r) return;
    try {
        clientesCrediario = (await api('/api/crediario/receber', {method: 'POST', body: {chave: c.chave, valor: lerValor(r.valor), metodo: r.metodo}})).clientes;
        avisar(`Recebido ${formatarMoeda(lerValor(r.valor))} de ${c.cliente}.`);
        renderizarCrediario();
    } catch (e) { avisar(e.message); }
}

// ---------- BACKUP ----------
async function carregarBackup() {
    const box = document.getElementById('backup-box');
    let b;
    try { b = await api('/api/backup'); } catch (e) { box.textContent = e.message; return; }
    const tamanho = n => n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.ceil(n / 1024) + ' KB';
    box.innerHTML = `
        <div class="cards-resumo">
            <div class="card-resumo"><span>Último backup</span><strong>${b.status ? formatarDataHora(b.status.ultimo) : 'Ainda não feito'}</strong></div>
            <div class="card-resumo"><span>Cópias guardadas</span><strong>${b.arquivos.length}</strong></div>
        </div>
        ${b.status?.erroExtra ? `<p class="form-error" role="alert">${escaparHtml(b.status.erroExtra)}</p>` : ''}
        ${!b.pastaExtra ? '<p class="aviso">As cópias estão só neste computador. Escolha uma pasta extra abaixo para ficar protegido se ele estragar.</p>' : ''}
        <form class="painel fechamento-form" onsubmit="event.preventDefault(); salvarBackup()">
            <label for="backup-pasta">Pasta extra para as cópias</label>
            <input id="backup-pasta" value="${escaparHtml(b.pastaExtra)}" placeholder="Ex.: E:\\Backup Acai ou C:\\Users\\voce\\Google Drive\\Backup">
            <p class="field-help">Use o caminho de um pen drive ou da pasta do Google Drive para computador. Deixe em branco para não copiar.</p>
            <p id="backup-erro" class="form-error" role="alert"></p>
            <div class="product-form-actions"><button class="btn btn-primary" type="submit">Salvar pasta</button><button class="btn btn-secondary" type="button" onclick="backupAgora()">Fazer backup agora</button></div>
        </form>
        <details class="ajuda">
            <summary>Cópias guardadas neste computador (${b.arquivos.length})</summary>
            <p class="field-help">Pasta: <code>${escaparHtml(b.pasta)}</code></p>
            <ul class="lista-backups">${b.arquivos.map(a => `<li><span>${escaparHtml(a.nome)} · ${tamanho(a.tamanho)}</span><a class="btn btn-secondary btn-sm" href="/api/backup/baixar?arquivo=${encodeURIComponent(a.nome)}" download>Baixar</a></li>`).join('') || '<li>Nenhuma cópia ainda.</li>'}</ul>
            <p><strong>Para restaurar:</strong> feche a janela do sistema, copie o arquivo do backup para a pasta <code>data</code> com o nome <code>produtos.db</code> (substituindo o atual) e abra o sistema de novo.</p>
        </details>`;
}
async function salvarBackup() {
    try { await api('/api/backup', {method: 'PUT', body: {pastaExtra: document.getElementById('backup-pasta').value}}); avisar('Pasta de backup salva.'); carregarBackup(); }
    catch (e) { document.getElementById('backup-erro').textContent = e.message; }
}
async function backupAgora() {
    try { const b = await api('/api/backup/agora', {method: 'POST', body: {}}); avisar(b.status.erroExtra ? 'Backup feito neste computador, mas a cópia extra falhou.' : 'Backup feito.'); carregarBackup(); }
    catch (e) { avisar(e.message); }
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
    const termo = document.getElementById('rel-busca-produto')?.value;
    const ranking = relatorioAtual.produtos.map((p, i) => ({...p, posicao: i + 1}))
        .filter(p => !normalizarBusca(termo) || notaBusca(termo, {nome: p.nome, extras: [p.categoria], codigos: [p.codigo]}) > 0);
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
        // Fecha só a janela de cima.
        const aberta = id => document.getElementById(id).classList.contains('active');
        if (aberta('modal-dialogo')) return responderDialogo(false);
        if (aberta('modal-adicionais')) return fecharAdicionais();
        if (aberta('modal-fila')) return fecharFila();
        if (aberta('modal-abertura-caixa')) return fecharAberturaCaixa();
        const janela = ['modal-transferencia', 'modal-pagamento'].find(aberta);
        if (janela) fecharJanela(janela); else if (comandaSelecionada) fecharModal();
    }
    if (event.target.id === 'input-item-modal') {
        if (event.key === 'Enter') { event.preventDefault(); adicionarItemPorPesquisa(); }
        if (event.key === 'ArrowDown') { event.preventDefault(); moverResultadoBusca(1); }
        if (event.key === 'ArrowUp') { event.preventDefault(); moverResultadoBusca(-1); }
    }
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

// Igual ao servidor: adicionais contam por unidade; no item por kg, uma vez só.
function totalItemCentavos(item) {
    const base = Math.round(centavos(item.preco) * Math.round(item.qtd * 1000) / 1000);
    const adicionais = (item.adicionais || []).reduce((s, a) => s + centavos(a.preco) * a.qtd, 0);
    return base + adicionais * (item.unidade === 'KG' ? 1 : item.qtd);
}
function definirQuantidadeItem(index, valor) {
    if (!comandaSelecionada) return;
    const item = comandas[comandaSelecionada].itens[index];
    const qtd = Number(valor);
    if (!Number.isFinite(qtd) || qtd <= 0 || qtd > 999999 || (item.unidade === 'KG' ? Math.abs(qtd * 1000 - Math.round(qtd * 1000)) > 0.000001 : !Number.isInteger(qtd))) {
        avisar('Informe uma quantidade válida. Para kg, use até três casas decimais.');
        abrirModalComanda(comandaSelecionada); return;
    }
    if (qtd < item.qtd && !podeReduzirSaldo((totalItemCentavos(item) - totalItemCentavos({...item, qtd})) / 100)) { abrirModalComanda(comandaSelecionada); return; }
    const jaFoi = qtdImpressa(item);
    item.qtd = qtd;
    marcarImpresso(item, jaFoi);
    renderizarTudo(); abrirModalComanda(comandaSelecionada);
}

// Quanto do item já foi para a cozinha: tudo, se está como enviado, ou a parte enviada antes de aumentarem a quantidade.
function qtdImpressa(item) { return item.impresso ? item.qtd : (item.qtdImpressa || 0); }
function qtdPendenteCozinha(item) { return Math.round((item.qtd - qtdImpressa(item)) * 1000) / 1000; }
function marcarImpresso(item, jaFoi) {
    delete item.qtdImpressa;
    item.impresso = jaFoi >= item.qtd;
    if (jaFoi > 0 && !item.impresso) item.qtdImpressa = jaFoi;
}

// ---------- IMPRESSÃO ----------
// Os cupons são montados como uma lista de blocos: {t:'texto'|'par'|'linha', v, e, d, b (negrito), g (grande), a ('c' centro, 'd' direita)}.
// O mesmo documento vira HTML (janela do navegador) ou comandos ESC/POS (servidor, impressora de rede ou USB compartilhada).
async function carregarImpressoras() {
    try { configImpressoras = await api('/api/impressoras'); } catch (e) { avisar(e.message); }
}

// Retorna {naFila:true, mensagem} quando a impressora da cozinha não respondeu e o pedido ficou guardado no servidor.
async function imprimir(destino, documento, extras = {}) {
    const cfg = configImpressoras?.[destino] || {modo: 'navegador', colunas: 48, letra: 'normal'};
    if (cfg.modo === 'navegador') { await imprimirNavegador(documento, cfg); return {impresso: true}; }
    const resultado = await api('/api/imprimir', {method: 'POST', body: {destino, documento, ...extras}});
    if (resultado.naFila) atualizarFila();
    return resultado;
}

const AUMENTO_LETRA = {normal: 0, grande: 1, extra: 2};
function tamanhoLetra(bloco, cfg) {
    const nivel = bloco.g === true ? 1 : bloco.g || 0;
    return Math.min(8, Math.max(1, nivel + (AUMENTO_LETRA[cfg.letra] ?? 0)));
}

function imprimirNavegador(documento, cfg) {
    const frame = document.getElementById('frame-impressao');
    frame.srcdoc = htmlImpressao(documento, cfg);
    return new Promise(resolve => {
        frame.onload = () => { frame.onload = null; frame.contentWindow.focus(); frame.contentWindow.print(); resolve(); };
    });
}

function htmlImpressao(documento, cfg) {
    const papel = cfg.colunas >= 42 ? 80 : 58;
    const bloco = b => {
        const classes = [b.b && 'b', b.a === 'c' && 'c', b.a === 'd' && 'd'].filter(Boolean).join(' ');
        const estilo = `font-size:${12 * tamanhoLetra(b, cfg)}px`;
        if (b.t === 'linha') return '<div class="linha"></div>';
        if (b.t === 'par') return `<div class="par ${classes}" style="${estilo}"><span>${escaparHtml(b.e)}</span><span>${escaparHtml(b.d)}</span></div>`;
        return `<p class="${classes}" style="${estilo}">${escaparHtml(b.v)}</p>`;
    };
    return `<!doctype html><html><head><meta charset="utf-8"><title>Impressão</title><style>
        @page { size: ${papel}mm auto; margin: 0; }
        body { margin: 0; padding: 3mm; width: ${papel - 8}mm; font: 12px/1.35 'Courier New', monospace; color: #000; }
        p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .b { font-weight: bold; } .c { text-align: center; } .d { text-align: right; }
        .par { display: flex; justify-content: space-between; gap: 8px; } .linha { border-top: 1px dashed #000; margin: 4px 0; }
    </style></head><body><!-- ${Date.now()} -->${documento.map(bloco).join('')}</body></html>`;
}

function agoraTexto() { return new Date().toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}); }
function quantidadeTexto(item) { return item.unidade === 'KG' ? `${Number(item.qtd).toLocaleString('pt-BR', {minimumFractionDigits: 3})} kg` : `${item.qtd}x`; }

// A cozinha só precisa saber o que preparar e qual comanda chamar: sem loja, preços ou atendente.
// O número da comanda que vibra é o que a cozinha digita para chamar o cliente.
function documentoCozinha(numero, itens, vibra = numero) {
    return [
        {t: 'texto', v: `COMANDA ${String(numero).padStart(2, '0')}`, b: true, g: 2, a: 'c'},
        {t: 'texto', v: `VIBRA ${String(vibra).padStart(2, '0')}`, b: true, g: 2, a: 'c'},
        {t: 'linha'},
        ...itens.flatMap(i => [
            {t: 'texto', v: `${quantidadeTexto(i)} ${i.nome}`, b: true, g: 1},
            ...(i.adicionais || []).map(a => ({t: 'texto', v: `  + ${a.qtd > 1 ? a.qtd + 'x ' : ''}${a.nome}`, g: 1})),
            ...(i.obs ? [{t: 'texto', v: `>> ${i.obs}`, b: true}] : [])
        ]),
        {t: 'linha'}
    ];
}

function documentoComprovante(venda) {
    const doc = (configImpressoras?.cabecalho || '').split('\n').filter(Boolean).map((v, i) => ({t: 'texto', v, b: i === 0, a: 'c'}));
    doc.push({t: 'texto', v: 'COMPROVANTE DE VENDA', b: true, a: 'c'},
        {t: 'texto', v: `Comanda ${String(venda.comanda).padStart(2, '0')} - ${formatarDataHora(venda.dataHora)}`, a: 'c'},
        {t: 'texto', v: `Atendente: ${venda.atendente}`, a: 'c'},
        {t: 'linha'});
    venda.itens.forEach(i => {
        doc.push({t: 'texto', v: i.nome}, {t: 'par', e: `  ${quantidadeTexto(i)} ${formatarMoeda(i.preco)}${i.unidade === 'KG' ? '/kg' : ''}`, d: formatarMoeda(i.total)});
        (i.adicionais || []).forEach(a => doc.push({t: 'par', e: `  + ${a.qtd}x ${a.nome}`, d: formatarMoeda(a.total)}));
    });
    doc.push({t: 'linha'}, {t: 'par', e: 'Subtotal', d: formatarMoeda(venda.subtotal)});
    if (venda.desconto) doc.push({t: 'par', e: 'Desconto', d: '-' + formatarMoeda(venda.desconto)});
    doc.push({t: 'par', e: 'TOTAL', d: formatarMoeda(venda.valor), b: true});
    venda.pagamentos.forEach(p => doc.push({t: 'par', e: p.metodo, d: formatarMoeda(p.valor)}));
    if (venda.troco) doc.push({t: 'par', e: 'Troco', d: formatarMoeda(venda.troco)});
    if (venda.cliente) doc.push({t: 'texto', v: `Cliente: ${venda.cliente}`});
    doc.push({t: 'linha'}, {t: 'texto', v: 'NÃO É DOCUMENTO FISCAL', b: true, a: 'c'});
    if (configImpressoras?.rodape) doc.push({t: 'texto', v: configImpressoras.rodape, a: 'c'});
    return doc;
}

async function imprimirComprovante(venda) {
    try { await imprimir('caixa', documentoComprovante(venda), {fila: false}); } catch (e) { avisar(e.message); }
}

function reimprimirVenda(id) {
    const venda = vendasHistorico.find(v => v.id === id);
    if (venda) imprimirComprovante(venda);
}

const MODOS_IMPRESSORA = {navegador: 'Janela de impressão do navegador', rede: 'Impressora de rede (IP)', windows: 'Impressora USB compartilhada no Windows'};
function renderizarImpressoras() {
    if (!configImpressoras) return;
    for (const destino of ['cozinha', 'caixa']) {
        const cfg = configImpressoras[destino];
        document.getElementById(`impressora-${destino}`).innerHTML = `
            <h4>${destino === 'cozinha' ? 'Cozinha' : 'Caixa'}</h4>
            <label for="imp-${destino}-modo">Como a impressora está ligada</label>
            <select id="imp-${destino}-modo" onchange="atualizarCampoEndereco('${destino}')">${Object.entries(MODOS_IMPRESSORA).map(([v, t]) => `<option value="${v}" ${cfg.modo === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <div id="imp-${destino}-endereco-box">
                <label id="imp-${destino}-endereco-label" for="imp-${destino}-endereco"></label>
                <div class="field-row"><input id="imp-${destino}-endereco" maxlength="120" value="${escaparHtml(cfg.endereco)}"><button class="btn btn-secondary" type="button" id="imp-${destino}-procurar" onclick="procurarImpressoras('${destino}')">Procurar na rede</button></div>
                <div id="imp-${destino}-encontradas" class="impressoras-encontradas" role="status"></div>
            </div>
            <div class="product-fields">
                <div><label for="imp-${destino}-colunas">Papel</label><select id="imp-${destino}-colunas"><option value="48" ${cfg.colunas !== 32 ? 'selected' : ''}>80 mm</option><option value="32" ${cfg.colunas === 32 ? 'selected' : ''}>58 mm</option></select></div>
                <div><label for="imp-${destino}-copias">Cópias</label><select id="imp-${destino}-copias">${[1, 2, 3].map(n => `<option ${cfg.copias === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            </div>
            ${destino === 'cozinha' ? `<label for="imp-cozinha-letra">Tamanho da letra dos itens</label><select id="imp-cozinha-letra">${[['normal', 'Normal'], ['grande', 'Grande (recomendado)'], ['extra', 'Extra grande']].map(([v, t]) => `<option value="${v}" ${cfg.letra === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
            <div id="imp-${destino}-acentos-box"><label for="imp-${destino}-acentos">Acentos</label><select id="imp-${destino}-acentos"><option value="remover" ${cfg.acentos === 'remover' ? 'selected' : ''}>Sem acentos (funciona em todas)</option><option value="cp850" ${cfg.acentos === 'cp850' ? 'selected' : ''}>Com acentos (página de código 850)</option></select></div>
            <button class="btn btn-secondary" type="button" style="margin-top:16px;" onclick="testarImpressora('${destino}')">Salvar e imprimir teste</button>`;
        atualizarCampoEndereco(destino);
    }
    document.getElementById('imp-comprovante').value = configImpressoras.comprovante;
    document.getElementById('imp-cabecalho').value = configImpressoras.cabecalho;
    document.getElementById('imp-rodape').value = configImpressoras.rodape;
    document.getElementById('impressoras-erro').textContent = '';
}

function atualizarCampoEndereco(destino) {
    const modo = document.getElementById(`imp-${destino}-modo`).value;
    document.getElementById(`imp-${destino}-endereco-box`).hidden = modo === 'navegador';
    document.getElementById(`imp-${destino}-acentos-box`).hidden = modo === 'navegador';
    document.getElementById(`imp-${destino}-endereco-label`).textContent = modo === 'rede' ? 'IP da impressora' : 'Nome do compartilhamento';
    document.getElementById(`imp-${destino}-endereco`).placeholder = modo === 'rede' ? 'Ex.: 192.168.0.50' : 'Ex.: COZINHA';
    document.getElementById(`imp-${destino}-procurar`).hidden = modo !== 'rede';
    document.getElementById(`imp-${destino}-encontradas`).replaceChildren();
}

async function procurarImpressoras(destino) {
    const botao = document.getElementById(`imp-${destino}-procurar`);
    const caixa = document.getElementById(`imp-${destino}-encontradas`);
    botao.disabled = true;
    caixa.textContent = 'Procurando impressoras na rede… leva alguns segundos.';
    try {
        const r = await api('/api/impressoras/procurar');
        caixa.replaceChildren();
        if (!r.impressoras.length) {
            caixa.textContent = 'Nenhuma impressora encontrada. Confira se ela está ligada e no mesmo Wi-Fi deste computador.';
            return;
        }
        const texto = document.createElement('span');
        texto.textContent = r.impressoras.length === 1 ? 'Encontrada:' : 'Encontradas (clique para usar):';
        caixa.append(texto);
        r.impressoras.forEach(ip => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn btn-secondary btn-sm'; b.textContent = ip;
            b.onclick = () => { document.getElementById(`imp-${destino}-endereco`).value = ip; caixa.textContent = `Usando ${ip}. Clique em "Salvar e imprimir teste" para confirmar.`; };
            caixa.append(b);
        });
        if (r.impressoras.length === 1) document.getElementById(`imp-${destino}-endereco`).value = r.impressoras[0];
    } catch (e) { caixa.textContent = e.message; }
    finally { botao.disabled = false; }
}

// ---------- FILA DE IMPRESSÃO ----------
let filaAtual = {pendentes: 0, falharam: 0, itens: []};
async function atualizarFila() {
    if (!usuario) return;
    try { filaAtual = await api('/api/impressoras/fila'); } catch { return; }
    const badge = document.getElementById('fila-badge');
    const total = filaAtual.pendentes + filaAtual.falharam;
    badge.hidden = !total;
    badge.textContent = filaAtual.falharam ? `${total} não impresso(s)` : `${total} na fila de impressão`;
    badge.title = 'Pedidos da cozinha esperando a impressora. Clique para ver.';
    badge.classList.toggle('falhou', !!filaAtual.falharam);
    if (document.getElementById('modal-fila').classList.contains('active')) renderizarFila();
}
setInterval(atualizarFila, 15000);

function abrirFila() { renderizarFila(); document.getElementById('modal-fila').classList.add('active'); }
function fecharFila() { document.getElementById('modal-fila').classList.remove('active'); }

function renderizarFila() {
    const box = document.getElementById('fila-lista');
    if (!filaAtual.itens.length) { box.innerHTML = '<p class="field-help">Nenhum pedido esperando. Tudo foi impresso.</p>'; return; }
    box.innerHTML = filaAtual.itens.map(j => `<div class="fila-item">
        <div><strong>${escaparHtml(j.descricao || 'Pedido da cozinha')}</strong>
        <small>${formatarDataHora(j.criadoEm)} · ${j.status === 'pendente' ? 'tentando de novo a cada 10 segundos' : 'parou de tentar depois de 30 minutos'}${j.erro ? ' · ' + escaparHtml(j.erro) : ''}</small></div>
        <div class="fila-acoes"><button class="btn btn-secondary btn-sm" onclick="acaoFila(${j.id}, 'reenviar')">Tentar agora</button><button class="btn btn-danger btn-sm" onclick="acaoFila(${j.id}, 'descartar')">Descartar</button></div>
    </div>`).join('');
}

async function acaoFila(id, acao) {
    try { filaAtual = await api(`/api/impressoras/fila/${id}/${acao}`, {method: 'POST', body: {}}); }
    catch (e) { avisar(e.message); }
    renderizarFila();
    setTimeout(atualizarFila, 1500);
}

function lerFormularioImpressoras() {
    const impressora = destino => ({
        modo: document.getElementById(`imp-${destino}-modo`).value,
        endereco: document.getElementById(`imp-${destino}-endereco`).value,
        colunas: Number(document.getElementById(`imp-${destino}-colunas`).value),
        acentos: document.getElementById(`imp-${destino}-acentos`).value,
        copias: Number(document.getElementById(`imp-${destino}-copias`).value),
        letra: document.getElementById(`imp-${destino}-letra`)?.value || configImpressoras[destino].letra
    });
    return {cozinha: impressora('cozinha'), caixa: impressora('caixa'), comprovante: document.getElementById('imp-comprovante').value, cabecalho: document.getElementById('imp-cabecalho').value, rodape: document.getElementById('imp-rodape').value};
}

async function salvarImpressoras() {
    document.getElementById('impressoras-erro').textContent = '';
    try {
        configImpressoras = await api('/api/impressoras', {method: 'PUT', body: lerFormularioImpressoras()});
        avisar('Configuração das impressoras salva.');
        return true;
    } catch (e) { document.getElementById('impressoras-erro').textContent = e.message; return false; }
}

async function testarImpressora(destino) {
    if (!await salvarImpressoras()) return;
    const doc = [
        ...configImpressoras.cabecalho.split('\n').filter(Boolean).map(v => ({t: 'texto', v, b: true, a: 'c'})),
        {t: 'texto', v: `TESTE ${destino === 'cozinha' ? 'COZINHA' : 'CAIXA'}`, b: true, g: 2, a: 'c'},
        {t: 'texto', v: agoraTexto(), a: 'c'},
        {t: 'linha'},
        {t: 'texto', v: '2x Açaí 500ml', b: true, g: 1},
        {t: 'texto', v: '>> exemplo de observação', b: true},
        {t: 'texto', v: 'Acentuação: Açaí, maçã, pão, café'},
        {t: 'par', e: 'Item à esquerda', d: 'R$ 12,34'},
        {t: 'linha'},
        {t: 'texto', v: 'Se este papel saiu, está tudo certo!', a: 'c'}
    ];
    try { await imprimir(destino, doc, {fila: false}); if (configImpressoras[destino].modo !== 'navegador') avisar('Teste enviado para a impressora.'); }
    catch (e) { document.getElementById('impressoras-erro').textContent = e.message; }
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
    renderizarProdutos();
    if (comandaSelecionada) pesquisarProdutosComanda();
}
function renderizarProdutos() {
    const termo = document.getElementById('produto-busca').value;
    const produtos = normalizarBusca(termo) ? buscarInteligente(produtosBase, termo, camposProduto) : produtosBase;
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
    document.getElementById('produto-adicional').checked = p.adicional;
    document.getElementById('produto-aceita-adicionais').checked = p.aceitaAdicionais;
    document.getElementById('produto-form-titulo').textContent = 'Editar produto';
    document.getElementById('produto-erro').textContent = ''; atualizarRotuloPreco();
    document.getElementById('produto-nome').focus();
}
async function salvarProduto() {
    if (!produtosConectados) return;
    const botao = document.getElementById('produto-salvar'); botao.disabled = true;
    document.getElementById('produto-erro').textContent = '';
    const id = document.getElementById('produto-id').value;
    const dados = {codigo:document.getElementById('produto-codigo').value.trim(),nome:document.getElementById('produto-nome').value.trim(),preco:Number(document.getElementById('produto-preco').value),unidade:document.getElementById('produto-unidade').value,categoria:document.getElementById('produto-categoria').value.trim(),codigoBarras:document.getElementById('produto-barras').value.trim(),requerCozinha:document.getElementById('produto-cozinha').checked,ativo:document.getElementById('produto-ativo').checked,adicional:document.getElementById('produto-adicional').checked,aceitaAdicionais:document.getElementById('produto-aceita-adicionais').checked};
    try {
        const result = await api('/api/produtos' + (id ? '/' + id : ''), {method:id ? 'PUT' : 'POST', body:dados});
        const index = produtosBase.findIndex(p => p.id === result.id);
        if (index < 0) produtosBase.push(result); else produtosBase[index] = result;
        produtosBase.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));
        renderizarProdutos(); novoProduto(); avisar('Produto salvo no banco local.');
    } catch(e) { document.getElementById('produto-erro').textContent = e.message; }
    finally { botao.disabled = !produtosConectados; }
}
