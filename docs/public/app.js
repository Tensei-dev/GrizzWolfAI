// Guia de estudos: índice, notas presas aos parágrafos (marcas expansíveis) e perguntas ao Claude.
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const pranchas = $$('.prancha');
const tituloDe = (id) => {
    const p = document.getElementById(id);
    return p ? `${$('.numero', p).textContent} · ${p.dataset.titulo}` : 'Geral';
};

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function markdown(text) {
    if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(text || '', { gfm: true, breaks: true }));
    return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
}

function quando(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
        + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const guardar = {
    ler(chave, padrao) { try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; } },
    gravar(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem armazenamento: segue sem lembrar */ } },
};

// ---------- Âncoras estáveis por parágrafo ----------
// O id vem do próprio texto, não da posição: reeditar outra parte do manual não move as notas.

function hashTexto(texto) {
    let h = 5381;
    for (const c of texto) h = ((h << 5) + h + c.codePointAt(0)) >>> 0;
    return h.toString(36);
}

for (const prancha of pranchas) {
    const usados = new Map();
    for (const el of $$('.conteudo > p, .conteudo li, .conteudo > figure, .conteudo .rolagem, .conteudo > .dica, .conteudo > .aviso', prancha)) {
        const base = `${prancha.id}-${hashTexto(el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160))}`;
        const n = (usados.get(base) || 0) + 1;
        usados.set(base, n);
        el.dataset.ancora = n === 1 ? base : `${base}-${n}`;
    }
}

// ---------- Índice e prancha atual ----------

const lista = $('#lista-pranchas');
lista.innerHTML = pranchas.map((p) => `
    <li><a href="#${p.id}" data-prancha="${p.id}">
        <span class="num">${$('.numero', p).textContent}</span>
        <span>${escapeHtml(p.dataset.titulo)}</span>
        <span class="qtd-notas" data-qtd="${p.id}"></span>
    </a></li>`).join('');

let pranchaAtual = pranchas[0].id;
const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
        if (!e.isIntersecting) continue;
        pranchaAtual = e.target.id;
        $$('a[data-prancha]', lista).forEach((a) => a.classList.toggle('atual', a.dataset.prancha === pranchaAtual));
    }
}, { rootMargin: '-45% 0px -50% 0px' });
pranchas.forEach((p) => observador.observe(p));

lista.addEventListener('click', () => document.body.classList.remove('indice-aberto'));
$('#abrir-indice').addEventListener('click', () => document.body.classList.toggle('indice-aberto'));

// Botões do cabeçalho de cada prancha e fichas de arquivos
for (const p of pranchas) {
    $('.acoes', p).innerHTML = `
        <button class="botao pequeno caneta" data-nova-nota="${p.id}">✎ Nota</button>
        <button class="botao pequeno ciano" data-perguntar="${p.id}">◆ Perguntar sobre esta prancha</button>`;
}
for (const caixa of $$('.arquivos')) {
    caixa.innerHTML = caixa.dataset.arquivos.split(/\s+/).filter(Boolean).map((f) => `
        <span class="arquivo">${escapeHtml(f)}<button type="button" data-explicar="${escapeHtml(f)}">explicar</button></span>`).join('');
}

// ---------- Notas ----------

let notas = [];

async function api(caminho, opcoes = {}) {
    const res = await fetch(caminho, { headers: { 'Content-Type': 'application/json' }, ...opcoes });
    if (!res.ok && res.status !== 204) {
        let erro = `HTTP ${res.status}`;
        try { erro = (await res.json()).erro || erro; } catch { /* corpo sem JSON */ }
        throw new Error(erro);
    }
    return res.status === 204 ? null : res.json();
}

async function carregarNotas() {
    try {
        notas = await api('/api/notas');
    } catch (err) {
        notas = [];
        console.error('não consegui carregar as notas', err);
    }
    desenharNotas();
}

function htmlMarca(nota) {
    return `
        <details class="marca" data-nota="${nota.id}" data-origem="${nota.origem}">
            <summary>${escapeHtml(nota.titulo || 'Nota sem título')}<span class="quando">${quando(nota.atualizadaEm)}</span></summary>
            <div class="corpo">
                ${nota.trecho ? `<blockquote>${escapeHtml(nota.trecho)}</blockquote>` : ''}
                <div class="texto-nota markdown">${markdown(nota.texto)}</div>
                <div class="acoes-nota">
                    <button class="botao pequeno caneta" data-editar="${nota.id}">Editar</button>
                    <button class="botao pequeno" data-apagar="${nota.id}">Apagar</button>
                </div>
            </div>
        </details>`;
}

// Onde a caixa de marcas de um parágrafo fica: logo depois dele (ou dentro, no fim, se for item de lista).
function caixaDeMarcas(ancora, criar = true) {
    const alvo = $(`[data-ancora="${CSS.escape(ancora)}"]`);
    if (!alvo) return null;
    const dentro = alvo.tagName === 'LI';
    let caixa = dentro ? $(':scope > .marcas', alvo) : (alvo.nextElementSibling?.classList.contains('marcas') ? alvo.nextElementSibling : null);
    if (!caixa && criar) {
        caixa = document.createElement('div');
        caixa.className = 'marcas';
        caixa.dataset.de = ancora;
        if (dentro) alvo.appendChild(caixa); else alvo.after(caixa);
    }
    return caixa;
}

function caixaGeral(prancha) {
    const conteudo = $('.conteudo', prancha);
    let bloco = $(':scope > .notas-gerais', conteudo);
    if (!bloco) {
        bloco = document.createElement('div');
        bloco.className = 'notas-gerais';
        bloco.innerHTML = `<h3>Notas da prancha</h3><div class="marcas"></div>
            <button class="botao pequeno caneta" data-nova-nota="${prancha.id}">✎ Nova nota</button>`;
        conteudo.appendChild(bloco);
    }
    return $('.marcas', bloco);
}

function desenharNotas() {
    // guarda quais marcas estavam abertas para não fechar tudo a cada redesenho
    const abertas = new Set($$('.marca[open]').map((d) => d.dataset.nota));
    $$('.marcas[data-de]').forEach((c) => c.remove());
    $$('[data-ancora].tem-nota').forEach((el) => el.classList.remove('tem-nota'));
    pranchas.forEach((p) => { caixaGeral(p).innerHTML = ''; });

    const orfas = [];
    for (const nota of notas) {
        let caixa = null;
        if (nota.ancora) {
            caixa = caixaDeMarcas(nota.ancora);
            if (caixa) $(`[data-ancora="${CSS.escape(nota.ancora)}"]`).classList.add('tem-nota');
        }
        if (!caixa) {
            const prancha = document.getElementById(nota.prancha);
            if (!prancha) { orfas.push(nota); continue; }
            caixa = caixaGeral(prancha);
        }
        caixa.insertAdjacentHTML('beforeend', htmlMarca(nota));
    }
    // notas cuja prancha não existe mais vão para a primeira prancha, para não sumirem
    for (const nota of orfas) caixaGeral(pranchas[0]).insertAdjacentHTML('beforeend', htmlMarca(nota));

    pranchas.forEach((p) => {
        const qtd = notas.filter((n) => n.prancha === p.id).length;
        $(`[data-qtd="${p.id}"]`).textContent = qtd ? `✎${qtd}` : '';
    });
    abertas.forEach((id) => { const d = $(`.marca[data-nota="${id}"]`); if (d) d.open = true; });
    if ($('#caderno').open) desenharCaderno();
}

// Formulário de nota, aberto no lugar onde a nota vai ficar.
function abrirFormulario({ prancha, ancora = null, trecho = null, nota = null }) {
    $$('.formulario-nota').forEach((f) => f.remove());
    const form = document.createElement('form');
    form.className = 'formulario-nota';
    const valorTrecho = nota?.trecho ?? trecho;
    form.innerHTML = `
        ${valorTrecho ? `<blockquote>${escapeHtml(valorTrecho)}</blockquote>` : ''}
        <label>Título<input name="titulo" maxlength="200" value="${escapeHtml(nota?.titulo || '')}" placeholder="Ex.: por que o RRF usa k = 60?"></label>
        <label>Nota (aceita Markdown)<textarea name="texto" placeholder="O que eu entendi, o que ainda não entendi…">${escapeHtml(nota?.texto || '')}</textarea></label>
        <div class="acoes-nota">
            <button type="button" class="botao pequeno" data-cancelar>Cancelar</button>
            <button type="submit" class="botao pequeno caneta">${nota ? 'Salvar alterações' : 'Salvar nota'}</button>
        </div>`;

    if (nota) {
        $(`.marca[data-nota="${nota.id}"]`).replaceWith(form);
    } else if (ancora) {
        caixaDeMarcas(ancora).prepend(form);
    } else {
        caixaGeral(document.getElementById(prancha)).after(form);
    }
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    form.elements.titulo.focus();

    form.addEventListener('click', (e) => { if (e.target.matches('[data-cancelar]')) { form.remove(); desenharNotas(); } });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dados = { titulo: form.elements.titulo.value.trim(), texto: form.elements.texto.value.trim() };
        if (!dados.titulo && !dados.texto) return form.elements.texto.focus();
        try {
            if (nota) {
                const salva = await api(`/api/notas/${nota.id}`, { method: 'PUT', body: JSON.stringify(dados) });
                notas = notas.map((n) => (n.id === salva.id ? salva : n));
            } else {
                const salva = await api('/api/notas', { method: 'POST', body: JSON.stringify({ ...dados, prancha, ancora, trecho, origem: 'manual' }) });
                notas.push(salva);
            }
            form.remove();
            desenharNotas();
        } catch (err) {
            alert(`Não consegui salvar a nota: ${err.message}`);
        }
    });
}

async function apagarNota(id) {
    const nota = notas.find((n) => n.id === id);
    if (!nota || !confirm(`Apagar a nota "${nota.titulo || 'sem título'}"?`)) return;
    try {
        await api(`/api/notas/${id}`, { method: 'DELETE' });
        notas = notas.filter((n) => n.id !== id);
        desenharNotas();
    } catch (err) {
        alert(`Não consegui apagar: ${err.message}`);
    }
}

// ---------- Seleção de texto: anotar ou perguntar ----------

const balao = $('#balao-selecao');
let selecao = null;

function lerSelecao() {
    const sel = window.getSelection();
    const texto = sel?.toString().replace(/\s+/g, ' ').trim();
    if (!sel || sel.isCollapsed || !texto) return null;
    const no = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const prancha = no?.closest('.prancha');
    if (!prancha || no.closest('.formulario-nota, .marca, .acoes, .carimbo')) return null;
    return {
        prancha: prancha.id,
        ancora: no.closest('[data-ancora]')?.dataset.ancora || null,
        trecho: texto.slice(0, 1200),
        retangulo: sel.getRangeAt(0).getBoundingClientRect(),
    };
}

document.addEventListener('mouseup', (e) => {
    if (balao.contains(e.target)) return;
    setTimeout(() => {
        selecao = lerSelecao();
        if (!selecao) return balao.classList.remove('visivel');
        balao.style.top = `${window.scrollY + selecao.retangulo.top - 46}px`;
        balao.style.left = `${Math.max(8, window.scrollX + selecao.retangulo.left)}px`;
        balao.classList.add('visivel');
    }, 0);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') balao.classList.remove('visivel'); });

$('#anotar-selecao').addEventListener('click', () => {
    if (!selecao) return;
    balao.classList.remove('visivel');
    abrirFormulario({ prancha: selecao.prancha, ancora: selecao.ancora, trecho: selecao.trecho });
    window.getSelection().removeAllRanges();
});
$('#perguntar-selecao').addEventListener('click', () => {
    if (!selecao) return;
    balao.classList.remove('visivel');
    abrirConversa({ prancha: selecao.prancha, trecho: selecao.trecho });
    window.getSelection().removeAllRanges();
});

// ---------- Conversa com o Claude ----------

const CHAVE_CONVERSA = 'estudos:conversa';
let conversa = guardar.ler(CHAVE_CONVERSA, []); // [{role, content, trecho?, prancha?, uso?}]
let contexto = { prancha: null, trecho: null };
let claudePronto = false;
let respondendo = false;

const mensagensEl = $('#mensagens');

function desenharContexto() {
    const el = $('#contexto-pergunta');
    if (!contexto.prancha) { el.innerHTML = 'Contexto: o repositório inteiro.'; return; }
    el.innerHTML = `Contexto: <strong>${escapeHtml(tituloDe(contexto.prancha))}</strong>`
        + (contexto.trecho ? `<button type="button" id="tirar-trecho">tirar o trecho</button><span class="trecho">"${escapeHtml(contexto.trecho)}"</span>` : '');
}

function htmlMensagem(m, i) {
    if (m.role === 'user') {
        return `<div class="mensagem estudante"><div class="autor">Você · ${escapeHtml(tituloDe(m.prancha))}</div>
            ${m.trecho ? `<blockquote class="markdown">"${escapeHtml(m.trecho)}"</blockquote>` : ''}
            <div class="markdown">${markdown(m.content)}</div></div>`;
    }
    if (m.role === 'erro') return `<div class="mensagem erro"><div class="autor">Erro</div>${escapeHtml(m.content)}</div>`;
    const uso = m.uso
        ? `<div class="uso">${m.uso.modelo} · entrada ${m.uso.entrada} · cache lido ${m.uso.cacheLido} · cache gravado ${m.uso.cacheGravado} · saída ${m.uso.saida}</div>` : '';
    return `<div class="mensagem claude" data-i="${i}"><div class="autor">Claude</div>
        <div class="markdown">${markdown(semTitulo(m.content))}</div>${uso}
        ${m.content ? `<div class="acoes-nota"><button class="botao pequeno caneta" data-salvar-resposta="${i}">✎ Salvar como nota</button></div>` : ''}</div>`;
}

// O tópico de uma resposta é o título "## …" com que o Claude a abre; sem ele, o começo da pergunta.
function tituloDaResposta(texto) {
    const linha = (texto || '').match(/^\s*#{1,3}\s+(.+)$/m)?.[1];
    return linha ? linha.replace(/[*_`]/g, '').trim() : null;
}

// A resposta sem o título de tópico, que já aparece no rótulo da marca.
function semTitulo(texto) {
    return tituloDaResposta(texto) ? texto.replace(/^\s*#{1,3}\s+.+\n*/m, '').trim() : texto;
}

function resumir(texto, limite = 90) {
    const t = (texto || '').replace(/\s+/g, ' ').trim();
    return t.length <= limite ? t : `${t.slice(0, limite).replace(/\s+\S*$/, '')}…`;
}

// Junta cada pergunta com a(s) resposta(s) seguinte(s): cada par vira uma marca expansível.
function trocasDaConversa() {
    const trocas = [];
    conversa.forEach((m, i) => {
        if (m.role === 'user' || !trocas.length) trocas.push({ pergunta: m.role === 'user' ? [i, m] : null, respostas: [] });
        if (m.role !== 'user') trocas.at(-1).respostas.push([i, m]);
    });
    return trocas;
}

function htmlTroca(troca, aberta) {
    const resposta = troca.respostas.find(([, m]) => m.role === 'assistant')?.[1];
    const topico = tituloDaResposta(resposta?.content) || resumir(troca.pergunta?.[1].content, 80) || 'Resposta';
    return `<details class="troca"${aberta ? ' open' : ''}>
        <summary>${escapeHtml(topico)}</summary>
        <div class="corpo-troca">
            ${troca.pergunta ? htmlMensagem(troca.pergunta[1], troca.pergunta[0]) : ''}
            ${troca.respostas.map(([i, m]) => htmlMensagem(m, i)).join('')}
        </div>
    </details>`;
}

function desenharConversa() {
    if (!claudePronto) {
        mensagensEl.innerHTML = `<div class="sem-chave">As perguntas ao Claude estão desligadas: falta a chave da API.<br><br>
            Crie o arquivo <code>docs/.env</code> com a linha <code>ANTHROPIC_API_KEY=sua-chave</code> e reinicie o servidor
            (<code>npm start</code> dentro de <code>docs/</code>). As notas funcionam normalmente.</div>`;
    } else if (!conversa.length) {
        mensagensEl.innerHTML = '<p class="vazio">Pergunte qualquer coisa sobre o código do GrizzWolfAI. O Claude lê o repositório inteiro e cita os arquivos e linhas.</p>';
    } else {
        const trocas = trocasDaConversa();
        mensagensEl.innerHTML = trocas.map((t, k) => htmlTroca(t, k === trocas.length - 1)).join('');
    }
    $('#enviar').disabled = !claudePronto || respondendo;
    mensagensEl.scrollTop = mensagensEl.scrollHeight;
}

function abrirConversa({ prancha = pranchaAtual, trecho = null } = {}) {
    contexto = { prancha, trecho };
    document.body.classList.add('conversa-aberta');
    desenharContexto();
    desenharConversa();
    $('#pergunta').focus();
}

// Lê os eventos do servidor (Server-Sent Events) de um fetch com corpo em streaming.
async function* lerEventos(res) {
    const leitor = res.body.getReader();
    const decodificador = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buffer += decodificador.decode(value, { stream: true });
        let fim;
        while ((fim = buffer.indexOf('\n\n')) !== -1) {
            const bloco = buffer.slice(0, fim);
            buffer = buffer.slice(fim + 2);
            const evento = bloco.match(/^event: (.*)$/m)?.[1];
            const dados = bloco.match(/^data: (.*)$/m)?.[1];
            if (evento && dados) yield { evento, dados: JSON.parse(dados) };
        }
    }
}

async function perguntar(pergunta) {
    respondendo = true;
    const historico = conversa.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
        .map((m) => ({ role: m.role, content: m.content }));
    conversa.push({ role: 'user', content: pergunta, prancha: contexto.prancha, trecho: contexto.trecho });
    const resposta = { role: 'assistant', content: '' };
    conversa.push(resposta);
    desenharConversa();
    const el = $(`.mensagem.claude[data-i="${conversa.length - 1}"] .markdown`);
    el.classList.add('digitando');

    let agendado = false;
    const redesenhar = () => {
        if (agendado) return;
        agendado = true;
        requestAnimationFrame(() => {
            agendado = false;
            el.innerHTML = markdown(semTitulo(resposta.content));
            // o rótulo da marca passa a ser o tópico assim que o título "## …" chega
            const topico = tituloDaResposta(resposta.content);
            if (topico) el.closest('.troca').querySelector('summary').textContent = topico;
            mensagensEl.scrollTop = mensagensEl.scrollHeight;
        });
    };

    try {
        const res = await fetch('/api/perguntar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pergunta, historico, prancha: contexto.prancha && tituloDe(contexto.prancha), trecho: contexto.trecho }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).erro || `HTTP ${res.status}`);
        for await (const { evento, dados } of lerEventos(res)) {
            if (evento === 'texto') { resposta.content += dados.texto; redesenhar(); }
            if (evento === 'aviso') resposta.content += `\n\n> ${dados.texto}`;
            if (evento === 'fim') resposta.uso = { modelo: dados.modelo, ...dados.uso };
            if (evento === 'erro') throw new Error(dados.texto);
        }
    } catch (err) {
        if (!resposta.content) conversa.pop();
        // TypeError do fetch = nem chegou no servidor (desligado ou reiniciando), não é erro do Claude.
        const desligado = err instanceof TypeError;
        conversa.push({ role: 'erro', content: desligado
            ? 'O servidor do guia não respondeu. Ele está ligado? Rode npm start dentro de docs/ e mande a pergunta de novo.'
            : err.message });
        if (desligado) verificarServidor();
    } finally {
        respondendo = false;
        guardar.gravar(CHAVE_CONVERSA, conversa.filter((m) => m.role !== 'erro'));
        desenharConversa();
    }
}

$('#form-pergunta').addEventListener('submit', (e) => {
    e.preventDefault();
    const campo = $('#pergunta');
    const pergunta = campo.value.trim();
    if (!pergunta || respondendo || !claudePronto) return;
    campo.value = '';
    perguntar(pergunta);
});
$('#pergunta').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#form-pergunta').requestSubmit(); }
});
$('#abrir-conversa').addEventListener('click', () => abrirConversa());
$('#fechar-conversa').addEventListener('click', () => document.body.classList.remove('conversa-aberta'));
$('#limpar-conversa').addEventListener('click', () => {
    if (respondendo || (conversa.length && !confirm('Começar uma conversa nova? A atual será apagada (as notas salvas ficam).'))) return;
    conversa = [];
    guardar.gravar(CHAVE_CONVERSA, conversa);
    desenharConversa();
});

async function salvarResposta(i) {
    const resposta = conversa[i];
    const pergunta = conversa.slice(0, i).reverse().find((m) => m.role === 'user');
    // Na prancha, a marca mostra só o tópico; a resposta inteira fica dentro dela, sem o título repetido.
    const topico = tituloDaResposta(resposta.content);
    const texto = semTitulo(resposta.content);
    try {
        const nota = await api('/api/notas', {
            method: 'POST',
            body: JSON.stringify({
                prancha: pergunta?.prancha || pranchaAtual,
                titulo: topico || resumir(pergunta?.content, 80) || 'Resposta do Claude',
                texto,
                origem: 'claude',
            }),
        });
        notas.push(nota);
        desenharNotas();
        const botao = $(`[data-salvar-resposta="${i}"]`);
        if (botao) { botao.textContent = '✓ Salva na prancha'; botao.disabled = true; }
    } catch (err) {
        alert(`Não consegui salvar: ${err.message}`);
    }
}

// ---------- Caderno e exportação ----------

function notasPorPrancha() {
    return pranchas.map((p) => ({ prancha: p, notas: notas.filter((n) => n.prancha === p.id) })).filter((g) => g.notas.length);
}

function desenharCaderno() {
    const grupos = notasPorPrancha();
    $('#caderno-corpo').innerHTML = grupos.length
        ? grupos.map(({ prancha, notas: lista }) => `
            <h3><a href="#${prancha.id}" data-fechar-caderno>${escapeHtml(tituloDe(prancha.id))}</a></h3>
            <div class="marcas">${lista.map(htmlMarca).join('')}</div>`).join('')
        : '<p class="vazio">Nenhuma nota ainda. Selecione um trecho de qualquer prancha e clique em "Anotar".</p>';
}

function exportarNotas() {
    const linhas = ['# Notas de estudo — GrizzWolfAI', '', `Exportado em ${quando(new Date().toISOString())}.`, ''];
    for (const { prancha, notas: lista } of notasPorPrancha()) {
        linhas.push(`## ${tituloDe(prancha.id)}`, '');
        for (const n of lista) {
            linhas.push(`### ${n.titulo || 'Nota sem título'}${n.origem === 'claude' ? ' (resposta do Claude)' : ''}`, '');
            if (n.trecho) linhas.push(`> ${n.trecho.replace(/\n/g, '\n> ')}`, '');
            linhas.push(n.texto, '', `_${quando(n.atualizadaEm)}_`, '');
        }
    }
    const url = URL.createObjectURL(new Blob([linhas.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'notas-grizzwolfai.md' });
    a.click();
    URL.revokeObjectURL(url);
}

$('#abrir-caderno').addEventListener('click', () => { desenharCaderno(); $('#caderno').showModal(); });
$('#fechar-caderno').addEventListener('click', () => $('#caderno').close());
$('#exportar-notas').addEventListener('click', exportarNotas);
$('#exportar-notas-caderno').addEventListener('click', exportarNotas);

// ---------- Cliques delegados ----------

document.addEventListener('click', (e) => {
    const alvo = e.target.closest('button, a');
    if (!alvo) return;
    if (alvo.dataset.novaNota) abrirFormulario({ prancha: alvo.dataset.novaNota });
    else if (alvo.dataset.perguntar) abrirConversa({ prancha: alvo.dataset.perguntar });
    else if (alvo.dataset.explicar) {
        abrirConversa({ prancha: alvo.closest('.prancha')?.id || pranchaAtual });
        $('#pergunta').value = `Explique o arquivo ${alvo.dataset.explicar}: o que ele faz, quem o chama e como se encaixa nesta prancha.`;
    } else if (alvo.dataset.editar) {
        const nota = notas.find((n) => n.id === alvo.dataset.editar);
        if ($('#caderno').open) $('#caderno').close();
        if (nota) abrirFormulario({ prancha: nota.prancha, ancora: nota.ancora, nota });
    } else if (alvo.dataset.apagar) apagarNota(alvo.dataset.apagar);
    else if (alvo.dataset.salvarResposta) salvarResposta(Number(alvo.dataset.salvarResposta));
    else if (alvo.id === 'tirar-trecho') { contexto.trecho = null; desenharContexto(); }
    else if (alvo.hasAttribute('data-fechar-caderno')) $('#caderno').close();
});

// ---------- Início ----------

async function verificarServidor() {
    const status = $('#status');
    try {
        const s = await api('/api/status');
        claudePronto = s.claude;
        status.className = `status ${s.claude ? 'ok' : 'erro'}`;
        status.textContent = s.claude
            ? `Claude pronto · ${s.arquivos} arquivos no contexto`
            : 'Claude sem chave · notas funcionando';
        status.title = `Modelo ${s.modelo}, esforço ${s.esforco}. ${s.caracteres.toLocaleString('pt-BR')} caracteres de código no contexto.`;
    } catch {
        claudePronto = false;
        status.className = 'status erro';
        status.textContent = 'servidor desligado · rode npm start em docs/';
    }
    desenharConversa();
}

desenharContexto();
verificarServidor();
// As notas inseridas depois do carregamento empurram o conteúdo: um link para "#p05" cairia no lugar errado.
carregarNotas().then(() => {
    const alvo = location.hash && document.getElementById(location.hash.slice(1));
    if (alvo) alvo.scrollIntoView({ behavior: 'instant' });
});
