const themeToggle = document.getElementById('theme-toggle');

themeToggle.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
});

// ===== Chat =====
const chatEl = document.getElementById('chat');
const messagesEl = document.getElementById('messages');
const form = document.getElementById('form-box');
const queryInput = document.getElementById('query');
const submitButton = form.querySelector('button[type="submit"]');

// ===== Histórico local =====
// as conversas ficam só neste navegador (localStorage); o servidor não guarda nada.
// conversa: { id, title, createdAt, updatedAt, profile, messages: [{ id, role, content, sources, model, question, rating }] }
// profile é o estado que o servidor devolve a cada resposta: curso, ano, pergunta pendente
const STORE_KEY = 'grizz:conversations';
const ACTIVE_KEY = 'grizz:activeConversation';
const MAX_CONVERSATIONS = 50;
const HISTORY_SENT = 6; // mensagens anteriores enviadas ao servidor como contexto
const TITLE_MAX_CHARS = 60;

function readStore() {
    try {
        const value = JSON.parse(localStorage.getItem(STORE_KEY));
        return Array.isArray(value) ? value : [];
    } catch (e) {
        return [];
    }
}

let conversations = readStore();
let conversationId = null;
try { conversationId = localStorage.getItem(ACTIVE_KEY); } catch (e) {}
// ids das versões anteriores, quando o histórico ficava no servidor
try { localStorage.removeItem('clientId'); localStorage.removeItem('conversationId'); } catch (e) {}

function saveStore() {
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    conversations = conversations.slice(0, MAX_CONVERSATIONS);
    for (;;) {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(conversations));
            return;
        } catch (e) {
            // armazenamento cheio: descarta a conversa mais antiga e tenta de novo
            if (conversations.length <= 1) return;
            conversations.pop();
        }
    }
}

function setActive(id) {
    conversationId = id;
    try {
        if (id) localStorage.setItem(ACTIVE_KEY, id);
        else localStorage.removeItem(ACTIVE_KEY);
    } catch (e) {}
}

function findConversation(id) {
    return conversations.find((c) => c.id === id) || null;
}

function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// as respostas vêm em Markdown (títulos, listas, tabelas…): o marked converte em HTML
// e o DOMPurify remove qualquer HTML perigoso. As citações [n] viram links para a fonte
const CITATION_MARK = (n) => `⟦${n}⟧`; // ⟦n⟧: o marked não mexe nesse texto

function formatAnswer(text, sources = []) {
    const urls = Object.fromEntries(sources.map((s) => [s.n, s.sourceUrl]));
    const markdown = text.replace(/\[(\d+)\]/g, (_, n) => CITATION_MARK(n));
    const html = window.marked && window.DOMPurify
        ? DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: true }))
        : `<p>${escapeHtml(markdown).replace(/\n/g, '<br>')}</p>`; // bibliotecas não carregaram
    return html.replace(/⟦(\d+)⟧/g, (_, n) => urls[n]
        ? `<a class="citation" href="${escapeHtml(urls[n])}" target="_blank" rel="noopener">[${n}]</a>`
        : `[${n}]`);
}

// a apresentação do Grizz some quando a conversa começa, e a caixa de texto desce
function setStarted(started) {
    chatEl.classList.toggle('started', started);
}

// miniatura do lobo ao lado das respostas; o CSS mostra a do tema atual
const GRIZZ_AVATAR = `
    <span class="avatar" aria-hidden="true">
        <img src="images/logo-grizz-light.svg" alt="" class="avatar-light">
        <img src="images/logo-grizz-dark.svg" alt="" class="avatar-dark">
    </span>`;

// retorna o <article> do balão (é nele que entram fontes e avaliação)
function addMessage(role, html) {
    setStarted(true);
    const isUser = role === 'user';
    const row = document.createElement('div');
    row.className = `message-row ${isUser ? 'user' : 'grizz'}`;
    row.innerHTML = `
        ${isUser ? '' : GRIZZ_AVATAR}
        <article class="message ${isUser ? 'user' : 'grizz'}">
            <p class="message-author">${isUser ? 'Você' : 'Grizz'}</p>
            <div class="message-text${isUser ? '' : ' markdown'}">${html}</div>
        </article>`;
    messagesEl.appendChild(row);
    return row.querySelector('article');
}

// ===== Rolagem =====
// a tela acompanha a conversa enquanto o usuário estiver perto do fim dela;
// se ele subir para reler algo, a rolagem automática para até ele voltar ao fim
const FOLLOW_THRESHOLD_PX = 120;
let followConversation = true;

function isNearBottom() {
    return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - FOLLOW_THRESHOLD_PX;
}

function scrollToBottom() {
    // rolagem instantânea: a suave dispara eventos de scroll no meio do caminho,
    // que fariam parecer que o usuário saiu do fim da conversa
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
}

window.addEventListener('scroll', () => { followConversation = isNearBottom(); }, { passive: true });

// qualquer crescimento da conversa (mensagem nova, resposta substituindo o
// "Farejando…", fontes abertas) rola a tela junto
new ResizeObserver(() => { if (followConversation) scrollToBottom(); }).observe(messagesEl);

function renderSources(article, sources) {
    if (sources.length === 0) return;
    const items = sources.map((s) => {
        const label = escapeHtml([s.title, s.page && `p. ${s.page}`].filter(Boolean).join(', '));
        const link = s.sourceUrl ? `<a href="${escapeHtml(s.sourceUrl)}" target="_blank" rel="noopener">${label}</a>` : label;
        return `<li>[${s.n}] ${link}</li>`;
    });
    article.insertAdjacentHTML('beforeend', `
        <details class="message-sources">
            <summary>Fontes (${sources.length})</summary>
            <ol>${items.join('')}</ol>
        </details>`);
}

// avaliação: o servidor guarda anonimamente só esta pergunta, a resposta, as fontes e a nota
function renderFeedback(article, conversation, message) {
    if (!message.model) return; // respostas fixas (pedido de curso/ano) não são avaliadas
    const box = document.createElement('div');
    box.className = 'message-feedback';
    article.appendChild(box);

    if (message.rating) {
        box.innerHTML = `<span>Você avaliou ${message.rating > 0 ? '👍' : '👎'}</span>`;
        return;
    }
    box.innerHTML = `
        <span>Ajudou?</span>
        <button type="button" data-rating="1" aria-label="Resposta útil">👍</button>
        <button type="button" data-rating="-1" aria-label="Resposta não ajudou">👎</button>`;
    box.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-rating]');
        if (!button) return;
        const rating = Number(button.dataset.rating);
        box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    answerId: message.id,
                    rating,
                    question: message.question,
                    answer: message.content,
                    sources: message.sources,
                    profile: conversation.profile,
                    model: message.model,
                }),
            });
            if (!res.ok && res.status !== 409) throw new Error();
            message.rating = rating;
            saveStore();
            box.innerHTML = '<span>Valeu pelo retorno! 🐺</span>';
        } catch (e) {
            box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        }
    });
}

function renderConversation(conversation) {
    for (const m of conversation.messages) {
        if (m.role === 'user') {
            addMessage('user', escapeHtml(m.content));
        } else {
            const article = addMessage('grizz', formatAnswer(m.content, m.sources));
            renderSources(article, m.sources || []);
            renderFeedback(article, conversation, m);
        }
    }
}

async function sendQuestion(question) {
    followConversation = true; // quem acabou de perguntar quer ver a resposta
    addMessage('user', escapeHtml(question));
    const pending = addMessage('grizz', '<span class="typing">Farejando os documentos…</span>');
    submitButton.disabled = true;
    const current = findConversation(conversationId);

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question,
                history: (current?.messages || []).slice(-HISTORY_SENT).map((m) => ({ role: m.role, content: m.content })),
                profile: current?.profile,
            }),
        });
        // a resposta pode não ser JSON (servidor fora do ar, página aberta fora do servidor)
        let data = null;
        try { data = await res.json(); } catch (e) {}
        if (!res.ok || !data) {
            throw new Error(data?.error || `O servidor não respondeu direito (HTTP ${res.status}). Confira se ele está rodando com npm run dev.`);
        }

        // só uma resposta bem-sucedida entra no histórico: se falhar, a pergunta não fica salva
        const now = new Date().toISOString();
        const conversation = current || {
            id: crypto.randomUUID(),
            title: question.length > TITLE_MAX_CHARS ? `${question.slice(0, TITLE_MAX_CHARS).trimEnd()}…` : question,
            createdAt: now,
            messages: [],
        };
        const answer = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: data.answer,
            sources: data.sources,
            model: data.model,
            question: data.question,
        };
        conversation.messages.push({ id: crypto.randomUUID(), role: 'user', content: question }, answer);
        conversation.profile = data.profile;
        conversation.updatedAt = now;
        if (!current) conversations.push(conversation);
        setActive(conversation.id);
        saveStore();

        pending.querySelector('.message-text').innerHTML = formatAnswer(data.answer, data.sources);
        renderSources(pending, data.sources);
        renderFeedback(pending, conversation, answer);
    } catch (err) {
        pending.classList.add('error');
        // fetch só lança TypeError quando não consegue nem conectar
        pending.querySelector('.message-text').textContent = err instanceof TypeError
            ? 'Não consegui falar com o servidor. Confira se ele está rodando com npm run dev.'
            : err.message;
    } finally {
        submitButton.disabled = false;
        queryInput.focus();
        // conversa nova entra no topo da lista; uma existente sobe para o topo
        renderConversationList();
    }
}

function openConversation(id) {
    const conversation = findConversation(id);
    if (!conversation) return startNewConversation();
    setActive(id);
    messagesEl.innerHTML = '';
    setStarted(false);
    closeSidebar();
    followConversation = true; // conversa reaberta começa mostrando as últimas mensagens
    renderConversation(conversation);
    highlightActiveConversation();
}

function startNewConversation() {
    setActive(null);
    messagesEl.innerHTML = '';
    setStarted(false);
    highlightActiveConversation();
    closeSidebar();
    queryInput.focus();
}

// ===== Barra lateral =====
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const conversationList = document.getElementById('conversation-list');
const conversationEmpty = document.getElementById('conversation-empty');

function openSidebar() {
    sidebar.classList.add('open');
    sidebarBackdrop.hidden = false;
    sidebarToggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarBackdrop.hidden = true;
    sidebarToggle.setAttribute('aria-expanded', 'false');
}

function formatDate(iso) {
    const date = new Date(iso);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function highlightActiveConversation() {
    conversationList.querySelectorAll('button[data-id]').forEach((b) => {
        b.setAttribute('aria-current', String(b.dataset.id === conversationId));
    });
}

function deleteConversation(id) {
    const title = findConversation(id)?.title || 'esta conversa';
    if (!confirm(`Apagar a conversa "${title}"? Isso não pode ser desfeito.`)) return;

    conversations = conversations.filter((c) => c.id !== id);
    saveStore();
    if (id === conversationId) startNewConversation();
    renderConversationList();
}

function renderConversationList() {
    conversationList.innerHTML = conversations.map((c) => `
        <li class="conversation-item">
            <button type="button" class="conversation-open" data-id="${c.id}" title="${escapeHtml(c.title)}">
                <span class="conversation-title">${escapeHtml(c.title)}</span>
                <span class="conversation-date">${formatDate(c.updatedAt)}</span>
            </button>
            <button type="button" class="conversation-delete" data-delete="${c.id}" aria-label="Apagar conversa: ${escapeHtml(c.title)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>
                </svg>
            </button>
        </li>`).join('');
    conversationEmpty.hidden = conversations.length > 0;
    highlightActiveConversation();
}

conversationList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('button[data-delete]');
    if (deleteButton) return deleteConversation(deleteButton.dataset.delete);

    const button = event.target.closest('button[data-id]');
    if (button && button.dataset.id !== conversationId) openConversation(button.dataset.id);
    else closeSidebar();
});

document.getElementById('new-chat').addEventListener('click', startNewConversation);
sidebarToggle.addEventListener('click', () => (sidebar.classList.contains('open') ? closeSidebar() : openSidebar()));
sidebarBackdrop.addEventListener('click', closeSidebar);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
});

// ===== Caixa de texto =====
form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = queryInput.value.trim();
    if (!question || submitButton.disabled) return;
    queryInput.value = '';
    autoResize();
    sendQuestion(question);
});

// Enter envia, Shift+Enter quebra linha
queryInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});

function autoResize() {
    queryInput.style.height = 'auto';
    queryInput.style.height = `${Math.min(queryInput.scrollHeight, 160)}px`;
}
queryInput.addEventListener('input', autoResize);

renderConversationList();
if (conversationId) openConversation(conversationId);
