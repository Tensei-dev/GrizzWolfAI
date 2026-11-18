const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk').default;

const PORT = Number(process.env.ESTUDOS_PORT) || 4100;
const MODEL = process.env.ESTUDOS_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.ESTUDOS_EFFORT || 'medium';
const DATA_DIR = process.env.ESTUDOS_DADOS ? path.resolve(process.env.ESTUDOS_DADOS) : path.join(__dirname, 'dados');
const NOTES_FILE = path.join(DATA_DIR, 'notas.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');

const MAX_QUESTION_CHARS = 4000;
const MAX_HISTORY_TURNS = 12;
const MAX_NOTE_CHARS = 20000;

const SKIP_FILES = /(^|\/)(package-lock\.json|LICENSE)$|\.(png|jpe?g|gif|svg|ico|pdf|woff2?|ttf|traineddata)$|^(conhecimento|docs)\//i;

async function readRepository() {
    const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((f) => f && !SKIP_FILES.test(f));
    const parts = [];
    for (const file of files) {
        let text;
        try {
            text = await fs.readFile(path.join(ROOT, file), 'utf8');
        } catch {
            continue;
        }
        const width = String(text.split('\n').length).length;
        const numbered = text.split('\n').map((line, i) => `${String(i + 1).padStart(width)}| ${line}`).join('\n');
        parts.push(`<arquivo caminho="${file}">\n${numbered}\n</arquivo>`);
    }
    return { files, text: parts.join('\n\n') };
}

const INSTRUCTIONS = `Você é o tutor do repositório GrizzWolfAI, um assistente RAG (perguntas e respostas sobre normas) da FACOM e do IME da UFU.
Quem pergunta está estudando o próprio código, com o apoio de um manual técnico dividido em pranchas (desenhos de arquitetura).
O código completo do repositório está abaixo, em <repositorio>, com as linhas numeradas.

Como responder:
- Comece toda resposta com uma linha de título em Markdown no formato "## <tópico>", com o assunto da resposta em até 8 palavras (ex.: "## server.js: a porta de entrada da API"). Esse título vira o nome da nota se o estudante salvar a resposta. Depois dele, não use outros títulos de nível 1 ou 2.
- Responda em português, de forma didática e direta.
- Baseie-se no código do repositório. Quando afirmar algo sobre ele, cite o lugar no formato \`caminho/arquivo.js:linha\` (ou um intervalo, \`arquivo.js:10-24\`).
- Se a pergunta for sobre algo que o código não mostra (dados do banco, conteúdo dos PDFs, configuração da Vercel ou do GitHub), diga isso e explique o que dá para inferir pelo código.
- Ao explicar um fluxo, siga a ordem em que o código executa e diga quais funções chamam quais.
- Use trechos curtos de código quando ajudarem, sem copiar arquivos inteiros.
- Se a pergunta vier com a prancha ou um trecho do manual que o estudante está lendo, use isso como contexto, mas confira no código: se o manual estiver desatualizado em relação ao código, diga.`;

let snapshot = null;
async function repositoryContext() {
    const { files, text } = await readRepository();
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    if (snapshot?.hash !== hash) snapshot = { hash, files, text, at: new Date().toISOString() };
    return snapshot;
}

async function readNotes() {
    try {
        return JSON.parse(await fs.readFile(NOTES_FILE, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function backupOfTheDay() {
    const file = path.join(BACKUP_DIR, `notas-${new Date().toISOString().slice(0, 10)}.json`);
    try {
        await fs.access(file);
    } catch {
        try {
            await fs.mkdir(BACKUP_DIR, { recursive: true });
            await fs.copyFile(NOTES_FILE, file);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
    }
}

let writing = Promise.resolve();
function saveNotes(notes) {
    writing = writing.then(async () => {
        await fs.mkdir(path.dirname(NOTES_FILE), { recursive: true });
        await backupOfTheDay();
        const tmp = `${NOTES_FILE}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(notes, null, 2));
        await fs.rename(tmp, NOTES_FILE);
    });
    return writing;
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);

function readNote(body, existing = {}) {
    return {
        ...existing,
        prancha: text(body.prancha, 100) ?? existing.prancha ?? 'geral',
        ancora: body.ancora === null ? null : text(body.ancora, 200) ?? existing.ancora ?? null,
        trecho: body.trecho === null ? null : text(body.trecho, 2000) ?? existing.trecho ?? null,
        titulo: text(body.titulo, 200) ?? existing.titulo ?? '',
        texto: text(body.texto, MAX_NOTE_CHARS) ?? existing.texto ?? '',
        origem: ['manual', 'claude'].includes(body.origem) ? body.origem : existing.origem ?? 'manual',
    };
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const VENDOR = path.join(__dirname, 'node_modules');
app.get('/vendor/marked.js', (req, res) => res.sendFile(path.join(VENDOR, 'marked', 'lib', 'marked.umd.js')));
app.get('/vendor/purify.js', (req, res) => res.sendFile(path.join(VENDOR, 'dompurify', 'dist', 'purify.min.js')));

app.get('/api/status', async (req, res) => {
    const repo = await repositoryContext();
    res.json({
        claude: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
        modelo: MODEL,
        esforco: EFFORT,
        arquivos: repo.files.length,
        caracteres: repo.text.length,
    });
});

app.get('/api/notas', async (req, res) => {
    res.json(await readNotes());
});

app.post('/api/notas', async (req, res) => {
    const note = readNote(req.body || {});
    if (!note.texto.trim() && !note.titulo.trim()) return res.status(400).json({ erro: 'A nota está vazia.' });
    const now = new Date().toISOString();
    const notes = await readNotes();
    const created = { id: crypto.randomUUID(), ...note, criadaEm: now, atualizadaEm: now };
    notes.push(created);
    await saveNotes(notes);
    res.status(201).json(created);
});

app.put('/api/notas/:id', async (req, res) => {
    const notes = await readNotes();
    const index = notes.findIndex((n) => n.id === req.params.id);
    if (index === -1) return res.status(404).json({ erro: 'Nota não encontrada.' });
    notes[index] = { ...readNote(req.body || {}, notes[index]), atualizadaEm: new Date().toISOString() };
    await saveNotes(notes);
    res.json(notes[index]);
});

app.delete('/api/notas/:id', async (req, res) => {
    const notes = await readNotes();
    const remaining = notes.filter((n) => n.id !== req.params.id);
    if (remaining.length === notes.length) return res.status(404).json({ erro: 'Nota não encontrada.' });
    await saveNotes(remaining);
    res.status(204).end();
});

function readHistory(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
        .slice(-MAX_HISTORY_TURNS * 2)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_NOTE_CHARS) }));
}

function errorMessage(err) {
    if (err instanceof Anthropic.AuthenticationError) return 'A chave da API do Claude foi recusada. Confira ANTHROPIC_API_KEY em docs/.env.';
    if (err instanceof Anthropic.PermissionDeniedError) return 'A chave da API não tem permissão para usar este modelo.';
    if (err instanceof Anthropic.RateLimitError) return 'Limite de uso da API do Claude atingido. Espere um pouco e pergunte de novo.';
    if (err instanceof Anthropic.BadRequestError) return `A API recusou a pergunta: ${err.message}`;
    if (err instanceof Anthropic.APIConnectionError) return 'Não consegui falar com a API do Claude. Confira a conexão com a internet.';
    if (err instanceof Anthropic.APIError) return `Erro da API do Claude (${err.status}): ${err.message}`;
    return `Erro inesperado: ${err.message}`;
}

app.post('/api/perguntar', async (req, res) => {
    const body = req.body || {};
    const question = text(body.pergunta, MAX_QUESTION_CHARS)?.trim();
    if (!question) return res.status(400).json({ erro: 'Pergunta vazia.' });
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
        return res.status(503).json({ erro: 'Configure ANTHROPIC_API_KEY em docs/.env e reinicie o servidor.' });
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const where = [
        text(body.prancha, 200) && `Estou lendo a prancha "${text(body.prancha, 200)}" do manual.`,
        text(body.trecho, 3000) && `Trecho do manual que selecionei:\n"""\n${text(body.trecho, 3000)}\n"""`,
    ].filter(Boolean).join('\n\n');

    let stream;
    try {
        const repo = await repositoryContext();
        const client = new Anthropic();
        stream = client.beta.messages.stream({
            model: MODEL,
            max_tokens: 64000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: EFFORT },
            system: [
                { type: 'text', text: INSTRUCTIONS },
                { type: 'text', text: `<repositorio>\n${repo.text}\n</repositorio>`, cache_control: { type: 'ephemeral', ttl: '1h' } },
            ],
            messages: [
                ...readHistory(body.historico),
                { role: 'user', content: where ? `${where}\n\n${question}` : question },
            ],
        });
        res.on('close', () => { if (!res.writableEnded) stream.abort(); });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send('texto', { texto: event.delta.text });
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === 'refusal') send('aviso', { texto: 'O Claude recusou esta pergunta.' });
        if (message.stop_reason === 'max_tokens') send('aviso', { texto: 'A resposta foi cortada por ser longa demais.' });
        send('fim', {
            modelo: message.model,
            uso: {
                entrada: message.usage.input_tokens,
                cacheLido: message.usage.cache_read_input_tokens || 0,
                cacheGravado: message.usage.cache_creation_input_tokens || 0,
                saida: message.usage.output_tokens,
            },
        });
    } catch (err) {
        if (!(err instanceof Anthropic.APIUserAbortError)) {
            console.error(err);
            send('erro', { texto: errorMessage(err) });
        }
    } finally {
        res.end();
    }
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ erro: err.message });
});

const server = app.listen(PORT, '127.0.0.1', async (err) => {
    if (err) return;
    const repo = await repositoryContext();
    console.log(`Guia de estudos em http://localhost:${PORT}`);
    console.log(`Repositório: ${repo.files.length} arquivos, ${Math.round(repo.text.length / 1000)} mil caracteres de contexto para o Claude`);
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
        console.log('Sem ANTHROPIC_API_KEY: o manual e as notas funcionam, mas as perguntas ao Claude ficam desligadas.');
    }
});

server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`A porta ${PORT} já está em uso: o guia provavelmente já está aberto em outro terminal (http://localhost:${PORT}).`);
    console.error('Feche o outro servidor ou use outra porta: ESTUDOS_PORT=4101 npm start');
    process.exitCode = 1;
});
